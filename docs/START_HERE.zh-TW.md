# 第一次把專案放上 GitHub

建議用電腦瀏覽器，全程不用指令。GitHub 專案庫保存程式與修改紀錄；GitHub Pages 提供可操作的網站。ChatGPT Sites 的私人預覽只供你先試用，尚不代表你的 GitHub 專案已公開。

## 依序完成

1. 到 [github.com/signup](https://github.com/signup) 註冊免費帳號，完成信箱驗證。[註冊說明](https://docs.github.com/en/account-and-profile/how-tos/account-management/creating-an-account-on-github)
2. 下載並解壓專案 ZIP。保留整包資料夾；先開啟 `dist/index.html` 試用。
3. 到 [github.com/new](https://github.com/new)，名稱填 `table-merge-starter`，選 **Public**。勾選 **Add README** 方便進入檔案頁；其他初始化選項留空，再按 **Create repository**。[建立專案說明](https://docs.github.com/en/get-started/start-your-journey/creating-a-repository-for-your-project-on-github)
4. 點 **Add file → Upload files**。拖入解壓後資料夾「裡面」的所有檔案與子資料夾，包含 `.github`；不要上傳 ZIP 本身。根目錄應直接看到 `README.md`、`LICENSE`、`dist`、`docs`，不要多包一層 `table-merge-starter`。用本包 README 取代剛建立的 README，提交訊息填「新增 v0.1.0 初始版本」，選直接提交至 `main`，完成 **Commit changes**。[上傳說明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
5. 確認有 `.github/workflows/pages.yml`。若漏了，用 **Add file → Create new file**，輸入這個完整路徑，貼入本包同名檔案內容後提交。斜線會建立子資料夾。[新增檔案說明](https://docs.github.com/en/repositories/working-with-files/managing-files/creating-new-files)
6. 到 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。已附工作流程，不必另選模板。[Pages 設定說明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
7. 到 **Actions → Deploy GitHub Pages → Run workflow**，選 `main` 並執行。完成後開啟該次執行中的網站網址；也可回 **Settings → Pages** 找網址。若先前因尚未設定 Pages 失敗，完成第 6 步後重新執行。

網站會公開。只上傳本包程式與虛構範例；自己的工作表留在本機。發布流程只送出 `dist`，之後更新 `main` 會再次部署。[工作流程依據](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

第一次成功後，把專案網址與網站網址記下來；下次修改再重做示範、去重及匯出檢查。
