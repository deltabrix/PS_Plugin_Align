# 🤖 AI 작업 지침서 (AI Rules)

이 프로젝트에서 작업하는 모든 AI 에이전트는 사용자의 별도 지시가 없더라도 최우선적으로 아래의 규칙을 엄격하게 준수해야 합니다.

## 1. 깃허브 실시간 자동 백업 (Auto-Commit & Push)
- 에러 수정, 기능 제안 등 **코드를 변경하는 작업이 끝나면, AI는 사용자에게 물어볼 필요 없이 곧바로 터미널을 통해 자동 백업을 실행**해야 합니다.
- 수정 작업이 마무리되는 턴의 마지막에 반드시 아래의 명령어를 백그라운드로 실행하세요:
  ```bash
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  git add .
  git commit -m "Auto-commit: [AI가 작업한 내용 요약]"
  git push
  ```
- 목적: 코딩을 모르는 사용자가 귀찮은 백업 명령어를 신경 쓰지 않도록, AI가 코딩부터 깃허브 클라우드 저장까지 100% 알아서 책임지고 실시간 동기화합니다.

## 2. 포토샵 UXP UI/UX 주의사항 (과거 에러 방지 기록)
- **절대 주의:** 일반 `<input>` 태그를 사용하면 포토샵 패널 렌더링 엔진에서 테두리 잘림, 색상 블랙아웃, 정렬 무시 등의 버그가 발생합니다.
- 텍스트 입력창 디자인 시 `<div>` 태그를 스타일링 래퍼(Wrapper)로 사용하고, 내부에서 입력만 담당하는 투명한 `<input>`을 감싸는 하이브리드 구조를 사용하거나 `<div contenteditable="true">` 구조를 사용하세요.
- 포토샵 단축키 실행 충돌을 막기 위해 텍스트 입력 시 반드시 `e.stopPropagation()`을 줘서 키보드 입력 탈취를 막아야 합니다.
