/**
 * Photoshop 간격 정렬 및 Align 플러그인 로직
 */
const { app, core } = require("photoshop");
const batchPlay = require("photoshop").action.batchPlay;

document.addEventListener("DOMContentLoaded", () => {
    const inputHoriz = document.getElementById("horiz-gap");
    const inputVert = document.getElementById("vert-gap");

    inputHoriz.addEventListener("keydown", (e) => {
        e.stopPropagation(); // 포토샵 키보드 단축키 탈취 방지 핵심 코드!!!
        if (e.key === "Enter" || e.keyCode === 13) {
            e.preventDefault(); // 텍스트박스 줄바꿈 차단
            e.target.blur();
            applyHorizontalGap();
        }
    });
    inputVert.addEventListener("keydown", (e) => {
        e.stopPropagation(); // 포토샵 키보드 단축키 탈취 방지 핵심 코드!!!
        if (e.key === "Enter" || e.keyCode === 13) {
            e.preventDefault(); // 텍스트박스 줄바꿈 차단
            e.target.blur();
            applyVerticalGap();
        }
    });

    document.getElementById("apply-horiz").addEventListener("click", () => applyHorizontalGap());
    document.getElementById("apply-vert").addEventListener("click", () => applyVerticalGap());

    [inputHoriz, inputVert].forEach(input => {
        // [중요 버그수정] keydown 캡처를 통한 포토샵 UXP 호스트의 단축키 탈취 원천 차단
        
        input.addEventListener("focus", (e) => {
            const target = e.target;
            target.dataset.oldVal = target.value.trim();
            target.value = ""; // 사용자 요청: 클릭 시 무조건 텅 비워버리기
        });
        
        input.addEventListener("blur", (e) => {
            const target = e.target;
            if (target.value.trim() === "") {
                target.value = target.dataset.oldVal || "0";
            }
        });
        
        // 엔터키 줄바꿈 등 텍스트 편집기 기본 동작 방지
        input.addEventListener("paste", (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            document.execCommand('insertText', false, text);
        });
    });

    document.getElementById("align-left").addEventListener("click", () => execAlign("ADSLefts"));
    document.getElementById("align-center-h").addEventListener("click", () => execAlign("ADSCentersH"));
    document.getElementById("align-right").addEventListener("click", () => execAlign("ADSRights"));
    document.getElementById("align-top").addEventListener("click", () => execAlign("ADSTops"));
    document.getElementById("align-center-v").addEventListener("click", () => execAlign("ADSCentersV"));
    document.getElementById("align-bottom").addEventListener("click", () => execAlign("ADSBottoms"));
    
    document.getElementById("distribute-v").addEventListener("click", () => execDistribute("ADSCentersV"));
    document.getElementById("distribute-h").addEventListener("click", () => execDistribute("ADSCentersH"));
});

// 값 형태가 Object(UnitValue)일 수 있으므로 순수한 Number로 변환하는 헬퍼 함수
const getNum = (val) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'object') {
        if (val.value !== undefined) return Number(val.value);
        if (val._value !== undefined) return Number(val._value); // BatchPlay 속성 대응
    }
    return Number(val);
};

// ──────────────────────────────────────────────────────────
// 초고속 직관적 바운드 측정 엔진 (복잡도 ZERO, 렉 ZERO)
// ──────────────────────────────────────────────────────────
// 사용자의 요구: "마스크나 adjustment layer 등 당장 눈에 보이지 않는 것들은 무시해라."
// 해답: 가장 빠르고 오류가 없는 순수 DOM bounds를 쓰되, 
// 그룹 크기를 우주 밖으로 날려버리던 주범(조정 레이어, 캔버스 꽉 채우는 배경/마스크 레이어)만 걸러냅니다.

function getBounds(layer, docW, docH) {
    if (!layer.visible) return null;
    
    // 1. 조정 레이어 등 쓸모없는 레이어 무시
    const ignorableKinds = [
        "blackAndWhite", "brightnessContrast", "channelMixer", "colorBalance", 
        "curves", "exposure", "hueSaturation", "invert", "levels", "photoFilter", 
        "posterize", "selectiveColor", "threshold", "vibrance", "colorLookup"
    ];
    if (ignorableKinds.includes(layer.kind)) return null;

    // 그룹일 경우 하위 레이어들을 탐색하여 '실제 내용물'의 크기만 합산
    if (layer.kind === "group" || (layer.layers && layer.layers.length > 0)) {
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        let valid = false;
        const children = layer.layers ? Array.from(layer.layers) : [];
        for (const child of children) {
            const cb = getBounds(child, docW, docH);
            if (cb) {
                valid = true;
                if (cb.left < minL) minL = cb.left;
                if (cb.top < minT) minT = cb.top;
                if (cb.right > maxR) maxR = cb.right;
                if (cb.bottom > maxB) maxB = cb.bottom;
            }
        }
        if (valid) return { left: minL, top: minT, right: maxR, bottom: maxB };
        return null;
    }

    // 일반 레이어의 Bounds 계산
    try {
        const b = layer.bounds;
        const left = getNum(b.left);
        const top = getNum(b.top);
        const right = getNum(b.right);
        const bottom = getNum(b.bottom);

        // [핵심 버그 픽스]
        // 만약 레이어가 캔버스 전체를 완전히 덮고 있다면(예: 배경색, 꽉 찬 마스크 등) 
        // 이는 그룹 크기를 부풀려 정렬을 망가뜨리는 주범이므로 크기 계산에서 제외합니다.
        if (left <= 0 && top <= 0 && right >= docW && bottom >= docH) {
            return null; 
        }

        return { left, top, right, bottom };
    } catch(e) {
        return null;
    }
}



async function applyHorizontalGap() {
    try {
        const input = document.getElementById("horiz-gap");
        let gapValueStr = input.value.trim();
        // 빈칸인 채로 엔터를 누르면 원래 저장해둔 값으로 복구해서 실행
        if (gapValueStr === "") gapValueStr = input.dataset.oldVal || "0";
        
        const gapValue = Number(gapValueStr);
        if (isNaN(gapValue)) return app.showAlert("정확한 숫자를 입력해주세요.");

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error("현재 열려있는 문서가 없습니다.");
            
            const originalSelection = Array.from(doc.activeLayers || []);
            if (originalSelection.length === 0) {
                 throw new Error("정렬할 레이어를 선택해주세요.");
            }
            
            // [버그 수정 1] 다중 선택 시 그룹 하위 레이어 무시하고 '가장 큰 그룹 덩어리'만 인식
            const selectedIds = new Set(originalSelection.map(l => l.id));
            const topmostLayers = originalSelection.filter(layer => {
                let p = layer.parent;
                while (p && p.typeName !== "Document") {
                    if (selectedIds.has(p.id)) return false;
                    p = p.parent;
                }
                return true;
            });
            
            const docW = doc.width;
            const docH = doc.height;
            
            // 빠르고 정확한 Bounds 읽기
            const layersData = [];
            for (const layer of topmostLayers) {
                let b = getBounds(layer, docW, docH);
                if (!b) {
                    b = { left: getNum(layer.bounds.left), right: getNum(layer.bounds.right) };
                }
                layersData.push({
                    layer: layer,
                    left: b.left,
                    right: b.right
                });
            }
            
            if (layersData.length === 1) {
                // 레이어 1개만 선택 시: 캔버스 왼쪽 끝(0) 기준 정렬
                const targetLayer = layersData[0].layer;
                const deltaX = gapValue - layersData[0].left;
                if (Math.abs(deltaX) > 0.01) {
                    doc.activeLayers = [targetLayer];
                    await targetLayer.translate(deltaX, 0);
                }
            } else {
                // 다중 선택 시 정렬
                layersData.sort((a, b) => a.left - b.left);
                
                let currentRightEdge = layersData[0].right;
                
                for (let i = 1; i < layersData.length; i++) {
                    const data = layersData[i];
                    
                    // 만약 getRealBounds가 완전히 null이면 굳이 이동하지 않음 (오류 방어)
                    if (isNaN(data.left) || isNaN(data.right)) continue;
                    
                    const targetLeftEdge = currentRightEdge + gapValue;
                    const deltaX = targetLeftEdge - data.left;
                    
                    if (Math.abs(deltaX) > 0.01) {
                        // 다중 선택 버그 방지를 위해 무조건 단독 선택 후 이동
                        doc.activeLayers = [data.layer];
                        await data.layer.translate(deltaX, 0);
                    }
                    
                    const layerWidth = data.right - data.left;
                    currentRightEdge = targetLeftEdge + layerWidth;
                }
                
                // 작업 완료 후 원래 상태로 선택 복구
                doc.activeLayers = originalSelection;
            }
        }, {"commandName": "가로 간격 조절"});

    } catch (err) {
        require("photoshop").app.showAlert("오류가 발생했습니다: " + err.message);
    }
}

async function applyVerticalGap() {
    try {
        const input = document.getElementById("vert-gap");
        let gapValueStr = input.value.trim();
        // 빈칸인 채로 엔터를 누르면 원래 저장해둔 값으로 복구해서 실행
        if (gapValueStr === "") gapValueStr = input.dataset.oldVal || "0";

        const gapValue = Number(gapValueStr);
        if (isNaN(gapValue)) return app.showAlert("정확한 숫자를 입력해주세요.");

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error("현재 열려있는 문서가 없습니다.");
            
            const originalSelection = Array.from(doc.activeLayers || []);
            if (originalSelection.length === 0) {
                 throw new Error("정렬할 레이어를 선택해주세요.");
            }
            
            // [버그 수정 1] 다중 선택 시 그룹 하위 레이어 무시하고 '가장 큰 그룹 덩어리'만 인식
            const selectedIds = new Set(originalSelection.map(l => l.id));
            const topmostLayers = originalSelection.filter(layer => {
                let p = layer.parent;
                while (p && p.typeName !== "Document") {
                    if (selectedIds.has(p.id)) return false;
                    p = p.parent;
                }
                return true;
            });
            
            const docW = doc.width;
            const docH = doc.height;
            
            // 빠르고 정확한 Bounds 읽기
            const layersData = [];
            for (const layer of topmostLayers) {
                let b = getBounds(layer, docW, docH);
                if (!b) {
                    b = { top: getNum(layer.bounds.top), bottom: getNum(layer.bounds.bottom) };
                }
                layersData.push({
                    layer: layer,
                    top: b.top,
                    bottom: b.bottom
                });
            }
            
            if (layersData.length === 1) {
                const targetLayer = layersData[0].layer;
                const deltaY = gapValue - layersData[0].top;
                if (Math.abs(deltaY) > 0.01) {
                    doc.activeLayers = [targetLayer];
                    await targetLayer.translate(0, deltaY);
                }
            } else {
                layersData.sort((a, b) => a.top - b.top);
                
                let currentBottomEdge = layersData[0].bottom;
                
                for (let i = 1; i < layersData.length; i++) {
                    const data = layersData[i];
                    
                    if (isNaN(data.top) || isNaN(data.bottom)) continue;
                    
                    const targetTopEdge = currentBottomEdge + gapValue;
                    const deltaY = targetTopEdge - data.top;
                    
                    if (Math.abs(deltaY) > 0.01) {
                        // 다중 선택 버그 방지를 위해 무조건 단독 선택 후 이동
                        doc.activeLayers = [data.layer];
                        await data.layer.translate(0, deltaY);
                    }
                    
                    const layerHeight = data.bottom - data.top;
                    currentBottomEdge = targetTopEdge + layerHeight;
                }
                
                // 작업 완료 후 원래 상태로 선택 복구
                doc.activeLayers = originalSelection;
            }
        }, {"commandName": "세로 간격 조절"});

    } catch (err) {
        require("photoshop").app.showAlert("오류가 발생했습니다: " + err.message);
    }
}

// 기본 Align 기능 실행 헬퍼
async function execAlign(alignmentStr) {
    const doc = app.activeDocument;
    if (!doc || doc.activeLayers.length === 0) {
        app.showAlert("정렬할 레이어를 한 개 이상 선택해주세요.");
        return;
    }
    try {
        await core.executeAsModal(async () => {
            if (doc.activeLayers.length === 1) {
                // 단일 객체 선택 시: 캔버스 전체를 선택 영역으로 잡고 정렬한 뒤 해제 (포토샵 네이티브 캔버스 정렬 트릭)
                await batchPlay([
                    { "_obj": "set", "_target": [ { "_ref": "channel", "_property": "selection" } ], "to": { "_enum": "ordinal", "_value": "allEnum" } },
                    {
                        "_obj": "align",
                        "_target": [ { "_ref": "layer", "_enum": "ordinal", "_value": "targetEnum" } ],
                        "using": { "_enum": "alignDistributeSelector", "_value": alignmentStr }
                    },
                    { "_obj": "set", "_target": [ { "_ref": "channel", "_property": "selection" } ], "to": { "_enum": "ordinal", "_value": "none" } }
                ], {});
            } else {
                // 다중 객체 선택 시: 객체들끼리 상호 정렬
                await batchPlay([
                    {
                        "_obj": "align",
                        "_target": [
                            { "_ref": "layer", "_enum": "ordinal", "_value": "targetEnum" }
                        ],
                        "using": { "_enum": "alignDistributeSelector", "_value": alignmentStr }
                    }
                ], {});
            }
        }, {"commandName": "기본 정렬 (" + alignmentStr + ")"});
    } catch(err) {
        app.showAlert("정렬 중 오류가 발생했습니다: " + err.message);
    }
}

// 기본 Distribute(분할) 기능 실행 헬퍼
async function execDistribute(alignmentStr) {
    if (!app.activeDocument || app.activeDocument.activeLayers.length < 3) {
        app.showAlert("간격을 분할해 정렬하려면 최소 3개 이상의 레이어를 선택하세요.");
        return;
    }
    try {
        await core.executeAsModal(async () => {
            await batchPlay([
                {
                    "_obj": "distribute",
                    "_target": [
                        { "_ref": "layer", "_enum": "ordinal", "_value": "targetEnum" }
                    ],
                    "using": { "_enum": "alignDistributeSelector", "_value": alignmentStr }
                }
            ], {});
        }, {"commandName": "간격 일정 정렬 (" + alignmentStr + ")"});
    } catch(err) {
        app.showAlert("자동 간격 정렬 중 오류가 발생했습니다: " + err.message);
    }
}
