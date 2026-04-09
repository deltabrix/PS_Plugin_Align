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
        // [중요 버그수정] keydown뿐만 아니라 keyup, keypress에서도 탈취당하지 않도록 방어
        input.addEventListener("keyup", (e) => e.stopPropagation());
        input.addEventListener("keypress", (e) => e.stopPropagation());
        
        input.addEventListener("focus", (e) => {
            const target = e.target;
            target.dataset.oldVal = target.textContent.trim();
            target.textContent = "";
        });
        
        input.addEventListener("blur", (e) => {
            const target = e.target;
            if (target.textContent.trim() === "") {
                target.textContent = target.dataset.oldVal || "0";
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
const getNum = (val) => (val && typeof val === 'object' && val.value !== undefined) ? Number(val.value) : Number(val);

// [신규 기능] 그룹 내부를 검사하여 Adjustment Layer (무한 캔버스 마스크) 등을 제외한 '실제' 픽셀 영역만 계산
function getRealBounds(layer) {
    if (layer.kind === "group" || layer.typeName === "LayerSet" || layer.isGroupLayer) {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        let hasValidChild = false;
        
        if (layer.layers && layer.layers.length > 0) {
            layer.layers.forEach(child => {
                const b = getRealBounds(child);
                if (b) {
                    left = Math.min(left, b.left);
                    top = Math.min(top, b.top);
                    right = Math.max(right, b.right);
                    bottom = Math.max(bottom, b.bottom);
                    hasValidChild = true;
                }
            });
        }
        
        if (!hasValidChild) {
            return {
                left: getNum(layer.bounds.left),
                top: getNum(layer.bounds.top),
                right: getNum(layer.bounds.right),
                bottom: getNum(layer.bounds.bottom)
            };
        }
        return { left, top, right, bottom };
    } else {
        const kindStr = layer.kind ? layer.kind.toString().toUpperCase() : "";
        // 화면 전역을 덮어 Bounds를 망가뜨리는 녀석들 총망라
        const ignoreKinds = [
            "BRIGHTNESSCONTRAST", "LEVELS", "CURVES", "EXPOSURE", "VIBRANCE", 
            "HUESATURATION", "COLORBALANCE", "BLACKANDWHITE", "PHOTOFILTER", 
            "CHANNELMIXER", "COLORLOOKUP", "INVERT", "POSTERIZE", "THRESHOLD", 
            "GRADIENTMAP", "SELECTIVECOLOR", "PATTERNFILL", "GRADIENTFILL", "SOLIDCOLOR", "ADJUSTMENT"
        ];
        
        if (ignoreKinds.includes(kindStr)) {
            return null; // 무시 (크기 합산에서 제외)
        }
        
        return { 
            left: getNum(layer.bounds.left), 
            top: getNum(layer.bounds.top), 
            right: getNum(layer.bounds.right), 
            bottom: getNum(layer.bounds.bottom) 
        };
    }
}

async function applyHorizontalGap() {
    try {
        const input = document.getElementById("horiz-gap");
        let gapValueStr = input.textContent.trim();
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
            
            // [버그 수정 2] 무거운 그룹의 Bounds 1회 캐싱 + Adjustment Layer 크기 무시
            const layersData = topmostLayers.map(layer => {
                const rb = getRealBounds(layer) || { 
                    left: getNum(layer.bounds.left), right: getNum(layer.bounds.right) 
                };
                return {
                    layer: layer,
                    left: rb.left,
                    right: rb.right
                };
            });
            
            if (layersData.length === 1) {
                // 레이어 1개만 선택 시: 캔버스 왼쪽 끝(0) 기준 정렬
                const targetLayer = layersData[0].layer;
                const deltaX = gapValue - layersData[0].left;
                if (Math.abs(deltaX) > 0.01) {
                    await targetLayer.translate(deltaX, 0);
                }
            } else {
                // 다중 선택 시 정렬
                layersData.sort((a, b) => a.left - b.left);
                
                let currentRightEdge = layersData[0].right;
                
                for (let i = 1; i < layersData.length; i++) {
                    const data = layersData[i];
                    const targetLeftEdge = currentRightEdge + gapValue;
                    const deltaX = targetLeftEdge - data.left;
                    
                    if (Math.abs(deltaX) > 0.01) {
                        // [버그 수정 3] 번쩍이더라도 반드시 해당 레이어만 단독 선택해야 함.
                        // 다중 선택 상태에서 translate를 실행하면 포토샵이 선택된 모든 그룹을 동시에 옮겨버려 우주로 날아감.
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
        let gapValueStr = input.textContent.trim();
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
            
            // [버그 수정 2] 무거운 그룹의 Bounds 1회 캐싱 + Adjustment Layer 크기 무시
            const layersData = topmostLayers.map(layer => {
                const rb = getRealBounds(layer) || { 
                    top: getNum(layer.bounds.top), bottom: getNum(layer.bounds.bottom) 
                };
                return {
                    layer: layer,
                    top: rb.top,
                    bottom: rb.bottom
                };
            });
            
            if (layersData.length === 1) {
                const targetLayer = layersData[0].layer;
                const deltaY = gapValue - layersData[0].top;
                if (Math.abs(deltaY) > 0.01) {
                    await targetLayer.translate(0, deltaY);
                }
            } else {
                layersData.sort((a, b) => a.top - b.top);
                
                let currentBottomEdge = layersData[0].bottom;
                
                for (let i = 1; i < layersData.length; i++) {
                    const data = layersData[i];
                    const targetTopEdge = currentBottomEdge + gapValue;
                    const deltaY = targetTopEdge - data.top;
                    
                    if (Math.abs(deltaY) > 0.01) {
                        // [버그 수정 3] 다중 선택 오프셋 중첩 방지를 위해 단독 선택 후 이동
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
    if (!app.activeDocument || app.activeDocument.activeLayers.length < 2) {
        app.showAlert("정렬하려면 최소 2개 이상의 레이어를 선택하세요.");
        return;
    }
    try {
        await core.executeAsModal(async () => {
            await batchPlay([
                {
                    "_obj": "align",
                    "_target": [
                        { "_ref": "layer", "_enum": "ordinal", "_value": "targetEnum" }
                    ],
                    "using": { "_enum": "alignDistributeSelector", "_value": alignmentStr }
                }
            ], {});
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
