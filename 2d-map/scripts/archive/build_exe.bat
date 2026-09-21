@echo off
rem ============================================================
 rem  重新打包两个启动器 exe（改了 scripts/start_server.py 或
 rem  scripts/rebuild_graph.py 之后运行本文件即可）
rem  前提: .venv 虚拟环境存在（内含 pyinstaller）
rem ============================================================
cd /d %~dp0..

.venv\Scripts\python.exe -m PyInstaller --onefile --name 启动导航演示 ^
  --distpath . --workpath build --specpath build scripts\start_server.py

.venv\Scripts\python.exe -m PyInstaller --onefile --name 重建路网 ^
  --distpath . --workpath build --specpath build --paths scripts scripts\rebuild_graph.py

echo.
echo 完成！exe 已生成在项目根目录，build\ 为中间产物可删除。
pause
