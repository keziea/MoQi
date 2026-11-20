; ═══════════════════════════════════════════════════════════════
; 墨栖安装器 · 自定义「数据存放位置」页
;
; 出现的时机：全新安装（%APPDATA%\moqi-reader 下既没有 data 也没有
; data-root.txt）。升级/重装时直接跳过，避免把用户已经改到 D 盘的
; 数据位置又指回默认目录。
;
; 规则与应用内完全一致：选一个目录 → 在里面建 MoQiReader → 数据放
; MoQiReader\data。应用读的是 %APPDATA%\moqi-reader\data-root.txt。
; ═══════════════════════════════════════════════════════════════

; 这个 include 会先于 installer.nsi 里的 MUI2.nsh 被处理，
; 但页面标题要用 MUI_HEADER_TEXT，所以自己先引入一次（MUI2 有 include guard，不会重复）。
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER

Var MoqiDataPage
Var MoqiDataEdit
Var MoqiDataBrowse
Var MoqiDataHint
Var MoqiDataParent
Var MoqiDataRoot

; 由 electron-builder 的 assisted installer 在「选择安装位置」之后插入
!macro customPageAfterChangeDir
  Page custom MoqiDataPageCreate MoqiDataPageLeave
!macroend

Function MoqiDataPageCreate
  IfFileExists "$APPDATA\moqi-reader\data\*.*" moqiSkipDataPage
  IfFileExists "$APPDATA\moqi-reader\data-root.txt" moqiSkipDataPage
  Goto moqiShowDataPage

moqiSkipDataPage:
  Abort

moqiShowDataPage:
  !insertmacro MUI_HEADER_TEXT "选择数据存放位置" "书架、笔记、书文件和阅读进度，都会保存在这里。"

  nsDialogs::Create 1018
  Pop $MoqiDataPage
  ${If} $MoqiDataPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "墨栖会在下面这个位置里新建一个 MoQiReader 文件夹，用来存放你的全部数据。$\r$\n以后也可以在软件里随时更改。"
  Pop $0

  ${NSD_CreateDirRequest} 0 36u 78% 13u "$DOCUMENTS"
  Pop $MoqiDataEdit
  ${NSD_OnChange} $MoqiDataEdit MoqiDataRefreshHint

  ${NSD_CreateBrowseButton} 79% 36u 21% 13u "浏览..."
  Pop $MoqiDataBrowse
  ${NSD_OnClick} $MoqiDataBrowse MoqiDataBrowseClick

  ${NSD_CreateLabel} 0 56u 100% 36u ""
  Pop $MoqiDataHint

  Call MoqiDataRefreshHint

  nsDialogs::Show
FunctionEnd

; 把用户选的目录换算成真正的数据根目录
Function MoqiDataComputeRoot
  ; 去掉末尾反斜杠："E:\" → "E:"，但保留 "E:" 本身
  StrCpy $0 $MoqiDataParent 1 -1
  ${If} $0 == "\"
    StrCpy $MoqiDataParent $MoqiDataParent -1
  ${EndIf}

  ; 用户直接选中了 MoQiReader 文件夹时，不再套一层
  ${GetFileName} $1 $MoqiDataParent
  ${If} $1 == "MoQiReader"
    StrCpy $MoqiDataRoot $MoqiDataParent
  ${Else}
    StrCpy $MoqiDataRoot "$MoqiDataParent\MoQiReader"
  ${EndIf}
FunctionEnd

Function MoqiDataBrowseClick
  ${NSD_GetText} $MoqiDataEdit $MoqiDataParent
  nsDialogs::SelectFolderDialog "选择数据存放位置" "$MoqiDataParent"
  Pop $0
  ${If} $0 != ""
  ${AndIf} $0 != "error"
    ${NSD_SetText} $MoqiDataEdit "$0"
    Call MoqiDataRefreshHint
  ${EndIf}
FunctionEnd

Function MoqiDataRefreshHint
  ${NSD_GetText} $MoqiDataEdit $MoqiDataParent
  ${If} $MoqiDataParent == ""
    ${NSD_SetText} $MoqiDataHint "请选择一个文件夹。"
    Return
  ${EndIf}
  Call MoqiDataComputeRoot
  ${NSD_SetText} $MoqiDataHint "将创建：$MoqiDataRoot$\r$\n数据会放在：$MoqiDataRoot\data"
FunctionEnd

Function MoqiDataPageLeave
  ${NSD_GetText} $MoqiDataEdit $MoqiDataParent
  ${If} $MoqiDataParent == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请先选择一个文件夹，用来存放墨栖的数据。"
    Abort
  ${EndIf}

  Call MoqiDataComputeRoot

  ClearErrors
  CreateDirectory "$MoqiDataRoot"
  IfErrors moqiCreateFailed

  CreateDirectory "$MoqiDataRoot\data"
  CreateDirectory "$APPDATA\moqi-reader"

  ClearErrors
  FileOpen $0 "$APPDATA\moqi-reader\data-root.txt" w
  IfErrors moqiRememberFailed
  FileWrite $0 "$MoqiDataRoot"
  FileClose $0
  Return

moqiCreateFailed:
  MessageBox MB_ICONSTOP|MB_OK "无法在这里创建文件夹：$\r$\n$MoqiDataRoot$\r$\n$\r$\n请换一个位置，或检查权限。"
  Abort

moqiRememberFailed:
  MessageBox MB_ICONEXCLAMATION|MB_OK "数据文件夹已经建好，但没能记住位置。$\r$\n墨栖第一次启动时会使用默认位置，你可以在软件里再改一次。"
FunctionEnd

!endif ; BUILD_UNINSTALLER
