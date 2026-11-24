"use strict";
(async function () {
  if (location.protocol === "file:") {
    document.body.style.cssText = "margin:0;padding:40px;background:#f3f6f9;color:#243f55;font:18px/1.8 -apple-system,BlinkMacSystemFont,sans-serif";
    document.body.innerHTML = '<main style="max-width:640px;margin:8vh auto;padding:32px;background:white;border-radius:16px"><h1 style="font-size:28px">请用启动器打开游戏</h1><p>回到「words are fun」文件夹，双击最外面的 <strong>启动游戏.command</strong>。</p><p>浏览器会自动打开完整游戏。这个内部网页不能直接双击试玩。</p><p>如果已经启动，可以<a href="http://localhost:8777/index.html">进入游戏</a>。</p></main>';
    return;
  }
  const assetVersion="simple-20261124-2";
  const files = ["js/data.js", "js/core.js", "js/game.js", "js/world3d.js", "js/cloud.js", "js/ui.js"];
  try {
    for (const file of files) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = file+"?v="+assetVersion;
        script.onload = resolve;
        script.onerror = () => reject(new Error("无法加载 " + file));
        document.body.appendChild(script);
      });
    }
  } catch (error) {
    console.error("游戏文件加载失败：", error);
    const hint = document.getElementById("hintText");
    if (hint) hint.textContent = "游戏文件未加载完整，请关闭页面后重新双击「启动游戏.command」。";
  }
})();
