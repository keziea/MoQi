; ═══════════════════════════════════════════════════════════════
; 墨栖安装器 · 单输入、固定两子目录
;
; 用户只选一个上级位置，安装器自动创建：
;
;   <上级>\MoQiReader\
;   ├── Program\    ← 程序本体（exe / resources / locales）
;   └── Data\       ← 全部用户数据（library / books / user / backups / exports / logs）
;
; 规则：
;   · 选到盘符根 D:\       → D:\MoQiReader
;   · 选到 D:\Apps         → D:\Apps\MoQiReader
;   · 选到 D:\Apps\MoQiReader → 不再套一层
;   · Data 固定；不写指针，不写 %APPDATA%；设置里也不能改。
;   · Program Files / Windows / 系统盘根一律拦截（数据要写在程序旁边，普通账户写不进去）。
;   · 升级只覆盖 Program，Data 不动；卸载默认保留 Data。
;
; 名字来自 build/folder-names.nsh（由 scripts/gen-names.js 生成）
; ═══════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "folder-names.nsh"

!ifndef BUILD_UNINSTALLER

Var MoqiRootEdit
Var MoqiRootWarn
Var MoqiFinalRoot

; ───────────────────── 页面注册 ─────────────────────

!macro customPageAfterChangeDir
  Page custom MoqiPathsPageCreate MoqiPathsPageLeave
!macroend

; ───────────────────── 小工具 ─────────────────────

; $0 in/out：去掉尾部反斜杠；"D:\" → "D:"
Function MoqiNormalize
  StrLen $4 "$0"
  ${If} $4 == 0
    Return
  ${EndIf}
  StrCpy $5 "$0" 1 -1
  ${If} $5 == "\"
    StrCpy $0 "$0" -1
  ${EndIf}
FunctionEnd

; $0 = 用户选的上级 → $2 = 软件容器目录（末级固定 MoQiReader）
Function MoqiJoinContainer
  Call MoqiNormalize
  ${GetFileName} "$0" $4
  ${If} $4 == "${CONTAINER_DIR_NAME}"
    StrCpy $2 "$0"
  ${Else}
    StrCpy $2 "$0\${CONTAINER_DIR_NAME}"
  ${EndIf}
FunctionEnd

; $R0 = 待检查路径 → $R1 = "1"（受保护）/"0"
Function MoqiProtectedCheck
  StrCpy $R1 "0"

  StrLen $R3 "$PROGRAMFILES"
  StrCpy $R4 "$R0" $R3
  ${If} $R4 == "$PROGRAMFILES"
    StrCpy $R1 "1"
    Return
  ${EndIf}

  StrLen $R3 "$PROGRAMFILES64"
  StrCpy $R4 "$R0" $R3
  ${If} $R4 == "$PROGRAMFILES64"
    StrCpy $R1 "1"
    Return
  ${EndIf}

  StrLen $R3 "$WINDIR"
  StrCpy $R4 "$R0" $R3
  ${If} $R4 == "$WINDIR"
    StrCpy $R1 "1"
    Return
  ${EndIf}

  ; 系统盘根：C:\ 或 C:
  StrCpy $R3 "$WINDIR" 2
  StrLen $R4 "$R0"
  ${If} $R4 <= 3
    StrCpy $R5 "$R0" 2
    ${If} $R5 == "$R3"
      StrCpy $R1 "1"
    ${EndIf}
  ${EndIf}
FunctionEnd

; $R0 = path → $R2 = "1"（超过 240 字符 / 含 < > " | ? *）
Function MoqiCheckPath
  StrCpy $R2 "0"
  StrLen $R3 "$R0"
  ${If} $R3 > 240
    StrCpy $R2 "1"
    Return
  ${EndIf}

  StrCpy $R4 "0"
  moqiPathCharLoop:
    StrCpy $R5 "$R0" 1 $R4
    ${If} $R5 == ""
      Goto moqiPathCharDone
    ${EndIf}
    ${If} $R5 == "<"
    ${OrIf} $R5 == ">"
    ${OrIf} $R5 == "$\""
    ${OrIf} $R5 == "|"
    ${OrIf} $R5 == "?"
    ${OrIf} $R5 == "*"
      StrCpy $R2 "1"
      Goto moqiPathCharDone
    ${EndIf}
    IntOp $R4 $R4 + 1
    Goto moqiPathCharLoop
  moqiPathCharDone:
FunctionEnd

; $R0 = dir → $R2 = "1"（目录里有任何文件或子目录）
Function MoqiDirHasEntries
  StrCpy $R2 "0"
  ClearErrors
  FindFirst $R3 $R4 "$R0\*.*"
  IfErrors moqiDirEntryDone
  moqiDirEntryLoop:
    ${If} $R4 == ""
      Goto moqiDirEntryDone
    ${EndIf}
    ${If} $R4 != "."
    ${AndIf} $R4 != ".."
      StrCpy $R2 "1"
      Goto moqiDirEntryDone
    ${EndIf}
    FindNext $R3 $R4
    Goto moqiDirEntryLoop
  moqiDirEntryDone:
  FindClose $R3
FunctionEnd

; ═════════════════════ 安装页：只选一个上级 ═════════════════════

Function MoqiPathsPageCreate
  !insertmacro MUI_HEADER_TEXT "选择安装位置" "墨栖会自动创建 MoQiReader，并在里面分好程序和数据。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 10u "安装位置（软件目录）"
  Pop $0

  ${NSD_CreateDirRequest} 0 12u 77% 12u "$LOCALAPPDATA\Programs\${CONTAINER_DIR_NAME}"
  Pop $MoqiRootEdit
  ${NSD_OnChange} $MoqiRootEdit MoqiRefresh

  ${NSD_CreateBrowseButton} 78% 12u 22% 12u "浏览..."
  Pop $0
  ${NSD_OnClick} $0 MoqiBrowse

  ${NSD_CreateLabel} 0 28u 100% 14u "会自动创建两个文件夹：Program（程序本体）和 Data（书、笔记、备份、日志）。$\r$\n数据固定跟在软件目录里，以后整个 MoQiReader 文件夹一起搬即可。"
  Pop $0

  ${NSD_CreateLabel} 0 46u 100% 18u ""
  Pop $MoqiRootWarn

  ${NSD_CreateLabel} 0 68u 100% 28u "安装位置必须可写：不要选 Program Files、Windows 或系统盘根。$\r$\n升级只覆盖 Program，Data 不会被删除；卸载默认也保留 Data。"
  Pop $0

  Call MoqiRefresh
  nsDialogs::Show
FunctionEnd

Function MoqiRefresh
  ${NSD_GetText} $MoqiRootEdit $0
  ${If} $0 == ""
    StrCpy $MoqiFinalRoot ""
    ${NSD_SetText} $MoqiRootWarn "请选择一个安装位置。"
    Return
  ${EndIf}

  Call MoqiJoinContainer
  StrCpy $MoqiFinalRoot "$2"

  StrCpy $3 ""
  StrCpy $R0 "$2"
  Call MoqiCheckPath
  ${If} $R2 == "1"
    StrCpy $3 "路径太长或包含 Windows 不允许的字符，请换一个位置。"
  ${EndIf}

  StrCpy $R0 "$2"
  Call MoqiProtectedCheck
  ${If} $R1 == "1"
    StrCpy $3 "不要放在 Program Files / Windows / 系统盘根：数据要写在程序旁边，普通账户写不进去。"
  ${EndIf}

  ${If} $3 == ""
    IfFileExists "$2\${PROGRAM_DIR_NAME}\${PRODUCT_FILENAME}.exe" 0 moqiCheckOld
      StrCpy $3 "检测到已安装的墨栖，将更新 Program；Data 不动。"
      Goto moqiRefreshDone
  moqiCheckOld:
    IfFileExists "$2\${PRODUCT_FILENAME}.exe" 0 moqiCheckData
      StrCpy $3 "检测到旧版程序在 MoQiReader 根目录；新版会装到 Program 子目录，旧文件可在安装后手动删除。"
      Goto moqiRefreshDone
  moqiCheckData:
    IfFileExists "$2\${DATA_DIR_NAME}\library.json" 0 moqiCheckMarker
      StrCpy $3 "这个位置已有 Data 数据，将直接复用。"
      Goto moqiRefreshDone
  moqiCheckMarker:
    IfFileExists "$2\${DATA_DIR_NAME}\.moqi-data" 0 moqiCheckNonEmpty
      StrCpy $3 "这个位置已经有 Data 文件夹，将直接复用。"
      Goto moqiRefreshDone
  moqiCheckNonEmpty:
    StrCpy $R0 "$2"
    Call MoqiDirHasEntries
    ${If} $R2 == "1"
      StrCpy $3 "这个文件夹不是空的：如果里面是别的软件，请换一个上级目录。"
    ${EndIf}
  moqiRefreshDone:
  ${EndIf}

  ${NSD_SetText} $MoqiRootWarn "$3"
FunctionEnd

Function MoqiBrowse
  ${NSD_GetText} $MoqiRootEdit $0
  ${If} $0 == ""
    StrCpy $0 "$LOCALAPPDATA\Programs"
  ${EndIf}
  nsDialogs::SelectFolderDialog "选择安装位置" "$0"
  Pop $0
  ${If} $0 != ""
  ${AndIf} $0 != "error"
    ; 选完把最终软件目录直接写回框里
    Call MoqiJoinContainer
    ${NSD_SetText} $MoqiRootEdit "$2"
    Call MoqiRefresh
  ${EndIf}
FunctionEnd

Function MoqiPathsPageLeave
  ${NSD_GetText} $MoqiRootEdit $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请先选择安装位置。"
    Abort
  ${EndIf}

  Call MoqiJoinContainer
  StrCpy $MoqiFinalRoot "$2"
  ${NSD_SetText} $MoqiRootEdit "$MoqiFinalRoot"

  StrCpy $R0 "$MoqiFinalRoot"
  Call MoqiCheckPath
  ${If} $R2 == "1"
    MessageBox MB_ICONSTOP|MB_OK "安装位置太长或包含 Windows 不允许的字符：$\r$\n$MoqiFinalRoot"
    Abort
  ${EndIf}

  StrCpy $R0 "$MoqiFinalRoot"
  Call MoqiProtectedCheck
  ${If} $R1 == "1"
    MessageBox MB_ICONSTOP|MB_OK "不要放在系统受保护目录：$\r$\n$MoqiFinalRoot$\r$\n$\r$\n数据要写在程序旁边，普通账户写不进去。请换到 D 盘或用户目录。"
    Abort
  ${EndIf}

  ; 如果 Data 已经存在但不是墨栖数据，避免误覆盖
  IfFileExists "$MoqiFinalRoot\${DATA_DIR_NAME}\.moqi-data" moqiDataOk
  IfFileExists "$MoqiFinalRoot\${DATA_DIR_NAME}\library.json" moqiDataOk
  StrCpy $R0 "$MoqiFinalRoot\${DATA_DIR_NAME}"
  Call MoqiDirHasEntries
  ${If} $R2 == "1"
    MessageBox MB_ICONSTOP|MB_OK "这个位置已经有 Data 文件夹，但看起来不是墨栖的数据：$\r$\n$MoqiFinalRoot\${DATA_DIR_NAME}$\r$\n$\r$\n为避免误覆盖，请换一个安装位置。"
    Abort
  ${EndIf}
  moqiDataOk:

  ; 真正的安装目录是 容器\Program；先定 $INSTDIR，再创建
  StrCpy $INSTDIR "$MoqiFinalRoot\${PROGRAM_DIR_NAME}"

  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors moqiCreateFailed
  CreateDirectory "$MoqiFinalRoot\${DATA_DIR_NAME}"
  IfErrors moqiCreateFailed

  ; 打标记，卸载/迁移靠它认目录
  IfFileExists "$MoqiFinalRoot\${DATA_DIR_NAME}\.moqi-data" moqiMarkerDone
    FileOpen $9 "$MoqiFinalRoot\${DATA_DIR_NAME}\.moqi-data" w
    IfErrors moqiMarkerDone
    FileWrite $9 `{"app":"${APP_NAME_EN}","kind":"data-dir","layout":"flat","version":3}`
    FileClose $9
  moqiMarkerDone:
  Return

moqiCreateFailed:
  MessageBox MB_ICONSTOP|MB_OK "无法在这里创建文件夹：$\r$\n$MoqiFinalRoot$\r$\n$\r$\n请换一个位置，或检查权限。"
  Abort
FunctionEnd

!endif ; BUILD_UNINSTALLER

; ═════════════════════ 卸载：默认保留 Data ═════════════════════

!ifdef BUILD_UNINSTALLER

Var UnDataPage
Var UnDataCheck
Var UnDataRoot

!macro customUnWelcomePage
  UninstPage custom un.MoqiUnDataPageCreate un.MoqiUnDataPageLeave
!macroend

Function un.MoqiUnDataPageCreate
  !insertmacro MUI_HEADER_TEXT "卸载选项" "程序会被删除，Data 默认保留。"

  nsDialogs::Create 1018
  Pop $UnDataPage
  ${If} $UnDataPage == error
    Abort
  ${EndIf}

  ; $INSTDIR 是 ...\MoQiReader\Program；Data 在它旁边
  ${GetParent} "$INSTDIR" $0
  StrCpy $UnDataRoot "$0\${DATA_DIR_NAME}"

  ${NSD_CreateLabel} 0 0 100% 34u "你的书、笔记、阅读进度都在：$\r$\n$UnDataRoot"
  Pop $0

  ${NSD_CreateCheckbox} 0 42u 100% 12u "同时删除 Data 文件夹（不可恢复）"
  Pop $UnDataCheck

  ${NSD_CreateLabel} 0 60u 100% 30u "不勾选就只删 Program；下次安装还能接着用。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.MoqiUnDataPageLeave
  ${NSD_GetState} $UnDataCheck $0
  ${If} $0 == 1
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "确定删除所有书、笔记和阅读进度吗？$\r$\n$UnDataRoot$\r$\n$\r$\n这个操作不可恢复。" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

!macro customUnInstall
  ${If} $UnDataCheck == 1
    StrLen $0 "$UnDataRoot"
    ${If} $0 > 4
      StrLen $0 "$INSTDIR"
      StrCpy $1 "$UnDataRoot" $0
      ${If} $1 != "$INSTDIR"
        IfFileExists "$UnDataRoot\.moqi-data" 0 moqiUnTryLibrary
          RMDir /r "$UnDataRoot"
          Goto moqiUnDone
  moqiUnTryLibrary:
        IfFileExists "$UnDataRoot\library.json" 0 moqiUnDone
          RMDir /r "$UnDataRoot"
      ${EndIf}
    ${EndIf}
  moqiUnDone:
    ; 容器如果空了也一起收掉
    ${GetParent} "$INSTDIR" $0
    RMDir "$0"
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER
