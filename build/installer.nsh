; ═══════════════════════════════════════════════════════════════
; 墨栖安装器 · 程序位置 + 数据位置 + 卸载数据选项
;
; 规则（与 docs/10 一致）：
;   · 程序目录：用户只选根，末级固定为 ${PROGRAM_DIR_NAME}
;   · 数据根目录：末级固定为 ${DATA_DIR_NAME}，用户只能选上级
;   · 数据与程序解耦；升级不移动数据
;   · 卸载默认保留数据，勾选并二次确认才删
;
; 名字全部来自 build/folder-names.nsh（由 scripts/gen-names.js 生成）
; ═══════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"
!include "folder-names.nsh"

!ifndef BUILD_UNINSTALLER

; ───────────────────────── 变量 ─────────────────────────

Var MoqiProgPage
Var MoqiProgRoot
Var MoqiProgPreview
Var MoqiProgWarn

Var MoqiDataPage
Var MoqiDataDefaultRadio
Var MoqiDataCustomRadio
Var MoqiDataParent
Var MoqiDataPreview
Var MoqiDataWarn

Var MoqiHasExisting
Var MoqiExistingRoot

; ───────────────────── 页面注册 ─────────────────────

!macro customPageAfterChangeDir
  Page custom MoqiProgramPageCreate MoqiProgramPageLeave
  Page custom MoqiDataPageCreate MoqiDataPageLeave
!macroend

; ───────────────────── 小工具 ─────────────────────

; $0 = 上级目录, $1 = 固定末级名 → $2 = 最终路径（自动去尾斜杠、避免重复拼）
Function MoqiJoinFixed
  StrCpy $3 $0 1 -1
  ${If} $3 == "\"
    StrCpy $0 $0 -1
  ${EndIf}
  ${GetFileName} $3 "$0"
  ${If} $3 == "$1"
    StrCpy $2 "$0"
  ${Else}
    StrCpy $2 "$0\$1"
  ${EndIf}
FunctionEnd

; $R0 = 待检查路径 → $R1 = "1"/"0"
Function MoqiProtectedCheck
  StrCpy $R1 "0"

  StrLen $2 "$PROGRAMFILES"
  StrCpy $3 "$R0" $2
  ${If} $3 == "$PROGRAMFILES"
    StrCpy $R1 "1"
    Return
  ${EndIf}

  StrLen $2 "$PROGRAMFILES64"
  StrCpy $3 "$R0" $2
  ${If} $3 == "$PROGRAMFILES64"
    StrCpy $R1 "1"
    Return
  ${EndIf}

  StrLen $2 "$WINDIR"
  StrCpy $3 "$R0" $2
  ${If} $3 == "$WINDIR"
    StrCpy $R1 "1"
    Return
  ${EndIf}

  ; 系统盘根：C:\ 或 C:
  StrCpy $1 "$WINDIR" 2
  StrLen $2 "$R0"
  ${If} $2 <= 3
    StrCpy $3 "$R0" 2
    ${If} $3 == "$1"
      StrCpy $R1 "1"
    ${EndIf}
  ${EndIf}
FunctionEnd

; ═════════════════════ ① 程序位置 ═════════════════════

Function MoqiProgramPageCreate
  ; 升级安装：$INSTDIR 已由注册表还原，且 exe 还在 → 跳过此页
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" 0 moqiProgFresh
    Abort
moqiProgFresh:

  !insertmacro MUI_HEADER_TEXT "选择程序安装位置" "程序文件只放在这里；书和笔记在下一页单独选。"

  nsDialogs::Create 1018
  Pop $MoqiProgPage
  ${If} $MoqiProgPage == error
    Abort
  ${EndIf}

  ; 默认根 = $INSTDIR 的父目录（通常是 ...\Programs）
  ${GetParent} "$INSTDIR" $MoqiProgRoot

  ${NSD_CreateLabel} 0 0 100% 22u "选一个根目录，${PRODUCT_NAME} 会在里面创建固定的 ${PROGRAM_DIR_NAME} 文件夹。"
  Pop $0

  ${NSD_CreateDirRequest} 0 26u 78% 13u "$MoqiProgRoot"
  Pop $MoqiProgRoot
  ${NSD_OnChange} $MoqiProgRoot MoqiProgRefresh

  ${NSD_CreateBrowseButton} 79% 26u 21% 13u "浏览..."
  Pop $0
  ${NSD_OnClick} $0 MoqiProgBrowse

  ${NSD_CreateLabel} 0 46u 100% 30u ""
  Pop $MoqiProgPreview

  ${NSD_CreateLabel} 0 78u 100% 26u ""
  Pop $MoqiProgWarn

  Call MoqiProgRefresh
  nsDialogs::Show
FunctionEnd

Function MoqiProgRefresh
  ${NSD_GetText} $MoqiProgRoot $0
  ${If} $0 == ""
    ${NSD_SetText} $MoqiProgPreview "请选择一个安装位置。"
    ${NSD_SetText} $MoqiProgWarn ""
    Return
  ${EndIf}

  StrCpy $1 "${PROGRAM_DIR_NAME}"
  Call MoqiJoinFixed
  ${NSD_SetText} $MoqiProgPreview "程序会安装到：$2"

  StrCpy $3 ""
  IfFileExists "$2\*.*" 0 +2
    StrCpy $3 "这个位置已经有 ${PROGRAM_DIR_NAME}，继续会更新程序文件；书和笔记在数据目录里，不受影响。"
  ${NSD_SetText} $MoqiProgWarn "$3"
FunctionEnd

Function MoqiProgBrowse
  ${NSD_GetText} $MoqiProgRoot $0
  nsDialogs::SelectFolderDialog "选择程序安装位置" "$0"
  Pop $0
  ${If} $0 != ""
  ${AndIf} $0 != "error"
    ${NSD_SetText} $MoqiProgRoot "$0"
    Call MoqiProgRefresh
  ${EndIf}
FunctionEnd

Function MoqiProgramPageLeave
  ${NSD_GetText} $MoqiProgRoot $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请先选择程序安装位置。"
    Abort
  ${EndIf}

  StrCpy $1 "${PROGRAM_DIR_NAME}"
  Call MoqiJoinFixed
  StrCpy $INSTDIR "$2"

  StrCpy $R0 "$INSTDIR"
  Call MoqiProtectedCheck
  ${If} $R1 == "1"
    MessageBox MB_ICONSTOP|MB_OK "不要放在系统受保护目录：$\r$\n$INSTDIR$\r$\n$\r$\n普通账户写入会被 Windows 虚拟化重定向，更新和读写都会出问题。请换到用户目录或 D 盘。"
    Abort
  ${EndIf}

  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors moqiProgCreateFailed
  Return

moqiProgCreateFailed:
  MessageBox MB_ICONSTOP|MB_OK "无法在这里创建文件夹：$\r$\n$INSTDIR$\r$\n$\r$\n请换一个位置，或检查权限。"
  Abort
FunctionEnd

; ═════════════════════ ② 数据位置 ═════════════════════

Function MoqiDataPageCreate
  ; 检测是否已有数据（升级 / 重装）
  StrCpy $MoqiHasExisting "0"
  StrCpy $MoqiExistingRoot ""
  IfFileExists "$APPDATA\${APP_NAME_EN}\data-root.txt" 0 moqiNoPointer
    FileOpen $1 "$APPDATA\${APP_NAME_EN}\data-root.txt" r
    FileRead $1 $MoqiExistingRoot
    FileClose $1
    StrCpy $MoqiExistingRoot "$MoqiExistingRoot\data"
    StrCpy $MoqiHasExisting "1"
    Goto moqiAfterDetect
moqiNoPointer:
  IfFileExists "$APPDATA\${APP_NAME_EN}\data\*.*" 0 moqiAfterDetect
    StrCpy $MoqiExistingRoot "$APPDATA\${APP_NAME_EN}\data"
    StrCpy $MoqiHasExisting "1"
moqiAfterDetect:

  ; 已有数据：只汇总，不移动
  ${If} $MoqiHasExisting == "1"
    !insertmacro MUI_HEADER_TEXT "确认程序与数据位置" "已有数据不会被移动"
    nsDialogs::Create 1018
    Pop $MoqiDataPage
    ${If} $MoqiDataPage == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 70u "程序会安装到：$INSTDIR$\r$\n$\r$\n现有数据位置：$MoqiExistingRoot$\r$\n安装不会移动数据。要换位置，装好后在「阅读设置 → 数据」里改，${PRODUCT_NAME} 会自动搬过去。"
    Pop $0
    nsDialogs::Show
    Return
  ${EndIf}

  ; 全新安装：默认系统位置 / 自定义
  !insertmacro MUI_HEADER_TEXT "选择数据存放位置" "书架、笔记、书和进度都在这里，和程序装在哪无关。"

  nsDialogs::Create 1018
  Pop $MoqiDataPage
  ${If} $MoqiDataPage == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 0 0 100% 12u "使用系统默认位置（推荐）"
  Pop $MoqiDataDefaultRadio
  ${NSD_OnClick} $MoqiDataDefaultRadio MoqiDataToggle

  ${NSD_CreateLabel} 12u 14u 88% 12u "$APPDATA\${APP_NAME_EN}\data"
  Pop $0

  ${NSD_CreateRadioButton} 0 30u 100% 12u "放到我自己选的位置"
  Pop $MoqiDataCustomRadio
  ${NSD_OnClick} $MoqiDataCustomRadio MoqiDataToggle

  ${NSD_CreateDirRequest} 12u 46u 66% 13u ""
  Pop $MoqiDataParent
  ${NSD_OnChange} $MoqiDataParent MoqiDataRefresh

  ${NSD_CreateBrowseButton} 79% 46u 21% 13u "浏览..."
  Pop $0
  ${NSD_OnClick} $0 MoqiDataBrowse

  ${NSD_CreateLabel} 12u 64u 88% 30u ""
  Pop $MoqiDataPreview

  ${NSD_CreateLabel} 0 96u 100% 20u ""
  Pop $MoqiDataWarn

  ${NSD_Check} $MoqiDataDefaultRadio
  Call MoqiDataToggle
  nsDialogs::Show
FunctionEnd

Function MoqiDataToggle
  ${NSD_GetState} $MoqiDataCustomRadio $0
  ${If} $0 == 1
    EnableWindow $MoqiDataParent 1
  ${Else}
    EnableWindow $MoqiDataParent 0
  ${EndIf}
  Call MoqiDataRefresh
FunctionEnd

Function MoqiDataRefresh
  ${NSD_GetState} $MoqiDataCustomRadio $0
  ${If} $0 != 1
    ${NSD_SetText} $MoqiDataPreview "数据会放在：$APPDATA\${APP_NAME_EN}\data"
    ${NSD_SetText} $MoqiDataWarn "系统默认位置不需要管理员权限，也不会被 Windows 虚拟化。"
    Return
  ${EndIf}

  ${NSD_GetText} $MoqiDataParent $1
  ${If} $1 == ""
    ${NSD_SetText} $MoqiDataPreview "请选择上级目录。"
    ${NSD_SetText} $MoqiDataWarn ""
    Return
  ${EndIf}

  StrCpy $0 "$1"
  StrCpy $1 "${DATA_DIR_NAME}"
  Call MoqiJoinFixed
  ${NSD_SetText} $MoqiDataPreview "将创建：$2$\r$\n数据目录：$2\data"
  ${NSD_SetText} $MoqiDataWarn "这一层 ${DATA_DIR_NAME} 由 ${PRODUCT_NAME} 固定使用，不能改名；你只选它放在哪个上级目录。"
FunctionEnd

Function MoqiDataBrowse
  ${NSD_GetText} $MoqiDataParent $0
  nsDialogs::SelectFolderDialog "选择数据存放位置" "$0"
  Pop $0
  ${If} $0 != ""
  ${AndIf} $0 != "error"
    ${NSD_SetText} $MoqiDataParent "$0"
    Call MoqiDataRefresh
  ${EndIf}
FunctionEnd

Function MoqiDataPageLeave
  ; 已有数据：汇总页，不改任何东西
  ${If} $MoqiHasExisting == "1"
    Return
  ${EndIf}

  ; 默认位置：不写指针
  ${NSD_GetState} $MoqiDataCustomRadio $0
  ${If} $0 != 1
    Delete "$APPDATA\${APP_NAME_EN}\data-root.txt"
    Return
  ${EndIf}

  ${NSD_GetText} $MoqiDataParent $1
  ${If} $1 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择数据存放的上级目录。"
    Abort
  ${EndIf}

  StrCpy $0 "$1"
  StrCpy $1 "${DATA_DIR_NAME}"
  Call MoqiJoinFixed
  StrCpy $3 "$2" ; $3 = 数据根

  ; 受保护目录
  StrCpy $R0 "$3"
  Call MoqiProtectedCheck
  ${If} $R1 == "1"
    MessageBox MB_ICONSTOP|MB_OK "不要放在系统受保护目录：$\r$\n$3$\r$\n$\r$\n请换到用户目录或 D 盘。"
    Abort
  ${EndIf}

  ; 已存在墨栖数据 → 复用；已存在别的东西 → 拒绝
  IfFileExists "$3\data\.moqi-data" moqiDataReuse
  IfFileExists "$3\data\library.json" moqiDataReuse
  IfFileExists "$3\*.*" moqiDataBlocked

  ClearErrors
  CreateDirectory "$3\data"
  IfErrors moqiDataCreateFailed
  Goto moqiDataWrite

moqiDataCreateFailed:
  MessageBox MB_ICONSTOP|MB_OK "无法创建数据目录：$\r$\n$3\data$\r$\n$\r$\n请换一个位置，或检查权限。"
  Abort

moqiDataReuse:
  MessageBox MB_YESNO|MB_ICONQUESTION "这个位置已经有 ${PRODUCT_NAME} 的数据：$\r$\n$3$\r$\n$\r$\n直接使用这份数据吗？" IDYES moqiDataWrite
  Abort

moqiDataBlocked:
  MessageBox MB_ICONSTOP|MB_OK "这个文件夹里已经有别的内容：$\r$\n$3$\r$\n$\r$\n为避免误覆盖，请换一个上级目录。"
  Abort

moqiDataWrite:
  CreateDirectory "$APPDATA\${APP_NAME_EN}"
  ClearErrors
  FileOpen $0 "$APPDATA\${APP_NAME_EN}\data-root.txt" w
  IfErrors moqiRememberFailed
  FileWrite $0 "$3"
  FileClose $0
  Return

moqiRememberFailed:
  MessageBox MB_ICONEXCLAMATION|MB_OK "数据文件夹已经建好，但没能记住位置。$\r$\n${PRODUCT_NAME} 第一次启动会使用系统默认位置，你可以在设置里再改一次。"
FunctionEnd

!endif ; BUILD_UNINSTALLER

; ═════════════════════ 卸载：数据删除选项 ═════════════════════

!ifdef BUILD_UNINSTALLER

Var UnDataPage
Var UnDataCheck
Var UnDataRoot
Var UnDataPath

!macro customUnWelcomePage
  UninstPage custom un.MoqiUnDataPageCreate un.MoqiUnDataPageLeave
!macroend

Function un.MoqiUnDataPageCreate
  !insertmacro MUI_HEADER_TEXT "卸载选项" "程序会被删除，用户数据默认保留。"

  nsDialogs::Create 1018
  Pop $UnDataPage
  ${If} $UnDataPage == error
    Abort
  ${EndIf}

  StrCpy $UnDataRoot ""
  IfFileExists "$APPDATA\${APP_NAME_EN}\data-root.txt" 0 moqiUnNoPointer
    FileOpen $0 "$APPDATA\${APP_NAME_EN}\data-root.txt" r
    FileRead $0 $UnDataRoot
    FileClose $0
moqiUnNoPointer:
  ${If} $UnDataRoot == ""
    StrCpy $UnDataRoot "$APPDATA\${APP_NAME_EN}"
  ${EndIf}
  StrCpy $UnDataPath "$UnDataRoot\data"

  ${NSD_CreateLabel} 0 0 100% 34u "你的书、笔记、阅读进度都在：$\r$\n$UnDataPath"
  Pop $0

  ${NSD_CreateCheckbox} 0 42u 100% 12u "同时删除这些用户数据（不可恢复）"
  Pop $UnDataCheck

  ${NSD_CreateLabel} 0 60u 100% 30u "不勾选就只删程序；下次安装还能接着用。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.MoqiUnDataPageLeave
  ${NSD_GetState} $UnDataCheck $0
  ${If} $0 == 1
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "确定删除所有书、笔记和阅读进度吗？$\r$\n$UnDataPath$\r$\n$\r$\n这个操作不可恢复。" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

!macro customUnInstall
  ${If} $UnDataCheck == 1
    ; 只删带墨栖标记、且不是盘符根 / 用户主目录 / 程序目录的路径
    StrLen $0 "$UnDataRoot"
    ${If} $0 > 4
      StrLen $0 "$INSTDIR"
      StrCpy $1 "$UnDataRoot" $0
      ${If} $1 != "$INSTDIR"
        IfFileExists "$UnDataRoot\data\.moqi-data" 0 moqiUnLegacy
          RMDir /r "$UnDataPath"
          RMDir "$UnDataRoot"
          Goto moqiUnDone
moqiUnLegacy:
        IfFileExists "$UnDataRoot\data\library.json" 0 moqiUnDone
          RMDir /r "$UnDataPath"
          RMDir "$UnDataRoot"
      ${EndIf}
    ${EndIf}
moqiUnDone:
    ; 只有删除数据时才清指针；保留数据时留着，重装还能找回原位置
    Delete "$APPDATA\${APP_NAME_EN}\data-root.txt"
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER
