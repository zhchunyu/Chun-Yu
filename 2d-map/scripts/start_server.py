# -*- coding: utf-8 -*-
"""
启动校园2D导航本地服务（可打包为 exe 双击运行）。

行为：
  1. 自动定位项目根目录（打包后 = exe 所在目录；源码运行 = 项目根）
  2. 若 8123 起的端口已有本服务在跑，直接打开浏览器复用，不重复起服务
  3. 以项目根为站点根启动静态服务，并自动用默认浏览器打开 /web/ 演示页
参数：
  --no-browser   只启动服务，不弹浏览器（调试用）
"""
import argparse
import functools
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT_START = 8123
PORT_END = 8139


def project_root():
    if getattr(sys, "frozen", False):  # PyInstaller 打包后
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def port_serving(port, timeout=0.3):
    """探测该端口上是否已有本服务在跑。

    刻意不用 urllib：有些环境（系统代理、防火墙、沙箱）会把"连到无人监听的
    本地端口"静默丢包而不是立即 RST，于是 urlopen 只能死等到超时——
    17 个端口扫一遍要 25 秒，看起来就像服务启动卡死。原始 socket 更直接也更快。
    """
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout) as s:
            s.sendall(b"GET /web/ HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            head = s.recv(200).split(b"\r\n", 1)[0]
            return b"200" in head
    except OSError:
        return False


def pause():
    try:
        if sys.stdin.isatty():
            input("按回车键退出...")
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = ap.parse_args()

    root = project_root()

    # 已有实例在跑 → 直接复用
    for p in range(PORT_START, PORT_END + 1):
        if port_serving(p):
            url = f"http://127.0.0.1:{p}/web/"
            print(f"检测到服务已在运行: {url}")
            if not args.no_browser:
                webbrowser.open(url)
            return

    # 找一个空闲端口
    port = None
    for p in range(PORT_START, PORT_END + 1):
        try:
            probe = ThreadingHTTPServer(("127.0.0.1", p), SimpleHTTPRequestHandler)
            probe.server_close()
            port = p
            break
        except OSError:
            continue
    if port is None:
        print(f"错误: {PORT_START}-{PORT_END} 端口均被占用，无法启动服务")
        pause()
        return

    os.chdir(root)  # 站点根 = 项目根，前端按 /data/... 取数
    url = f"http://127.0.0.1:{port}/web/"
    handler = functools.partial(SimpleHTTPRequestHandler, directory=root)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)

    print("=" * 50)
    print("  校园2D导航 本地服务已启动")
    print(f"  演示页: {url}")
    print("  停止服务: 关闭本窗口，或按 Ctrl+C")
    print("=" * 50)
    if not args.no_browser:
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")


if __name__ == "__main__":
    main()
