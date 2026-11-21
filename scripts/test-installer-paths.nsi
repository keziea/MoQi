; 安装器路径逻辑测试（v0.8 单输入布局）。
; 由 scripts/test-installer-paths.js 传 ROOT / OUT / RESULT 三个 !define。
; 只验证 installer.nsh 里的纯路径函数，不显示界面。

Unicode true
Name "Moqi installer path test"
OutFile "${OUT}"
RequestExecutionLevel user

!addincludedir "${ROOT}\build"
!define PRODUCT_NAME "墨栖"
!define PRODUCT_FILENAME "墨栖"
!include "${ROOT}\build\installer.nsh"

Section
  FileOpen $9 "${RESULT}" w

  ; ── 只选一个上级，自动补 MoQiReader ──
  StrCpy $0 "D:\"
  Call MoqiJoinContainer
  FileWrite $9 "join_drive=$2$\r$\n"

  StrCpy $0 "D:"
  Call MoqiJoinContainer
  FileWrite $9 "join_drive_no_slash=$2$\r$\n"

  StrCpy $0 "D:\Apps"
  Call MoqiJoinContainer
  FileWrite $9 "join_parent=$2$\r$\n"

  StrCpy $0 "D:\Apps\MoQiReader"
  Call MoqiJoinContainer
  FileWrite $9 "join_already_named=$2$\r$\n"

  StrCpy $0 "E:\Backups"
  Call MoqiJoinContainer
  FileWrite $9 "join_backups=$2$\r$\n"

  ; ── 路径合法性 ──
  StrCpy $R0 "D:\Apps\MoQiReader"
  Call MoqiCheckPath
  FileWrite $9 "path_normal=$R2$\r$\n"

  StrCpy $R0 "D:\a<b"
  Call MoqiCheckPath
  FileWrite $9 "path_illegal=$R2$\r$\n"

  StrCpy $R0 "D:\"
  StrCpy $R7 "0"
  moqiLongLoop:
    StrCpy $R0 "$R0a"
    IntOp $R7 $R7 + 1
    ${If} $R7 < 238
      Goto moqiLongLoop
    ${EndIf}
  Call MoqiCheckPath
  FileWrite $9 "path_too_long=$R2$\r$\n"

  ; ── 受保护目录 ──
  StrCpy $R0 "$PROGRAMFILES\Moqi"
  Call MoqiProtectedCheck
  FileWrite $9 "protected_program_files=$R1$\r$\n"

  StrCpy $R0 "D:\Apps"
  Call MoqiProtectedCheck
  FileWrite $9 "protected_normal=$R1$\r$\n"

  ; ── 目录是否为空 ──
  RMDir /r "$TEMP\moqi-nsis-empty"
  RMDir /r "$TEMP\moqi-nsis-sub"
  RMDir /r "$TEMP\moqi-nsis-file"
  CreateDirectory "$TEMP\moqi-nsis-empty"
  CreateDirectory "$TEMP\moqi-nsis-sub\child"
  CreateDirectory "$TEMP\moqi-nsis-file"
  FileOpen $8 "$TEMP\moqi-nsis-file\a.txt" w
  FileWrite $8 "x"
  FileClose $8

  StrCpy $R0 "$TEMP\moqi-nsis-empty"
  Call MoqiDirHasEntries
  FileWrite $9 "entries_empty=$R2$\r$\n"

  StrCpy $R0 "$TEMP\moqi-nsis-sub"
  Call MoqiDirHasEntries
  FileWrite $9 "entries_empty_child=$R2$\r$\n"

  StrCpy $R0 "$TEMP\moqi-nsis-file"
  Call MoqiDirHasEntries
  FileWrite $9 "entries_file=$R2$\r$\n"

  RMDir /r "$TEMP\moqi-nsis-missing"
  StrCpy $R0 "$TEMP\moqi-nsis-missing"
  Call MoqiDirHasEntries
  FileWrite $9 "entries_missing=$R2$\r$\n"

  FileClose $9
SectionEnd
