import { Dialog, Plugin, showMessage, fetchPost, getFrontend } from "siyuan";

export default class InstallPackage extends Plugin {
    onload() {
        console.log("InstallPackage loaded");

        this.addTopBar({
            icon: "iconInstallPackagePlugin",
            title: "Install Package",
            position: "right",
            callback: this.topBarHandler,
        });

        this.addIcons(
`<symbol id="iconInstallPackagePlugin" viewBox="0 0 32 32">
    <path d="M15.996 23.275q-0.317 0-0.59-0.104t-0.53-0.362l-7.163-7.162q-0.482-0.491-0.457-1.145t0.478-1.136q0.495-0.482 1.16-0.489t1.148 0.474l4.353 4.384v-15.545q0-0.682 0.463-1.144t1.149-0.462q0.684 0 1.142 0.462t0.457 1.144v15.545l4.384-4.384q0.476-0.482 1.129-0.457t1.148 0.506q0.453 0.482 0.462 1.14t-0.474 1.14l-7.13 7.13q-0.257 0.258-0.534 0.362t-0.594 0.104zM3.795 31.417q-1.301 0-2.257-0.956t-0.956-2.257v-4.914q0-0.682 0.463-1.144t1.148-0.462 1.143 0.462 0.457 1.144v4.914h24.409v-4.914q0-0.682 0.463-1.144t1.148-0.462 1.143 0.462 0.457 1.144v4.914q0 1.301-0.956 2.257t-2.257 0.956h-24.409z"></path>
</symbol>`
        );
    }

    onLayoutReady() {
        // console.log("InstallPackage onLayoutReady");
    }

    onunload() {
        // console.log("InstallPackage unloaded");
    }

    uninstall() {
        // console.log("InstallPackage uninstalled");
    }

    private topBarHandler = () => {
        const dialog = new Dialog({
            title: "Install Package",
            width: isMobile() ? "92vw" : "520px",
            content: 
`<div class="b3-dialog__content">
    URL of the GitHub repository
    <div class="fn__hr"></div>
    <input data-type="url" class="b3-text-field fn__block" value="https://github.com/" placeholder="format: https://github.com/user/repo">
    <div class="fn__hr"></div>
    Version (Git Tag) of the package (optional)
    <div class="fn__hr"></div>
    <input data-type="version" class="b3-text-field fn__block" value="" placeholder="install latest version by default">
    <div class="fn__hr"></div>
    Enable the plugin package after install
    <div class="fn__hr"></div>
    <input data-type="enable" class="b3-switch fn__flex fn__flex-center" style="overflow: visible;" type="checkbox" checked>
</div>
<div class="b3-dialog__action">
    <button data-type="cancel" class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const urlInput = dialog.element.querySelector("input[data-type='url']") as HTMLInputElement;
        const versionInput = dialog.element.querySelector("input[data-type='version']") as HTMLInputElement;
        const enableInput = dialog.element.querySelector("input[data-type='enable']") as HTMLInputElement;
        dialog.bindInput(urlInput, () => {
            this.installPackage(urlInput.value, versionInput.value, enableInput.checked);
        });
        dialog.bindInput(versionInput, () => {
            this.installPackage(urlInput.value, versionInput.value, enableInput.checked);
        });
        urlInput.select();

        const cancelButton = dialog.element.querySelector("button[data-type='cancel']") as HTMLButtonElement;
        cancelButton.addEventListener("click", () => {
            dialog.destroy();
        });
        const confirmButton = dialog.element.querySelector("button[data-type='confirm']") as HTMLButtonElement;
        confirmButton.addEventListener("click", () => {
            this.installPackage(urlInput.value, versionInput.value, enableInput.checked);
            dialog.destroy();
        });
    }

    private installPackage = async (url: string, version: string, enable: boolean) => {
        url = url.trim();
        version = version.trim();

        try {
            console.log("InstallPackage installPackage", url, version, enable);
            
            // 验证 GitHub URL，确保包含用户名和仓库名
            const githubUrlMatch = url.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/)?$/);
            if (!githubUrlMatch || !githubUrlMatch[1] || !githubUrlMatch[2]) {
                this.showMessage("Please enter a valid GitHub repository URL with username and repository name, format: https://github.com/user/repo", "error");
                return;
            }
            
            const [, owner, repo] = githubUrlMatch;
            console.log("Getting repository information...");
            
            // 获取仓库信息
            const repoInfo = await this.getRepositoryInfo(owner, repo);
            if (!repoInfo) {
                this.showMessage("Unable to get repository information, please check if the repository exists", "error");
                return;
            }
            
            // 显示仓库信息
            console.log(`Repository: ${repoInfo.full_name}`);
            console.log(`Description: ${repoInfo.description || 'No description'}`);
            console.log(`Stars: ${repoInfo.stargazers_count}`);
            console.log(`Last updated: ${new Date(repoInfo.updated_at).toLocaleDateString()}`);
            
            // 获取 Release 信息
            const releaseInfo = await this.getReleaseInfo(owner, repo, version);
            if (!releaseInfo) {
                this.showMessage(`Unable to get Release information for version ${version || 'latest'}`, "error");
                return;
            }
            
            console.log("Release Info:", releaseInfo);
            this.showMessage(`Found Release: ${releaseInfo.tag_name}${releaseInfo.published_at ? ` (published on ${new Date(releaseInfo.published_at).toLocaleDateString()})` : ''}`, "info");
            
            // 显示 Release 描述（如果有的话）
            if (releaseInfo.body && releaseInfo.body.trim()) {
                console.log(`Release description: ${releaseInfo.body.substring(0, 200)}${releaseInfo.body.length > 200 ? '...' : ''}`);
            }
            
            // 查找包文件
            const pluginAsset = this.findPluginAsset(releaseInfo.assets);
            if (!pluginAsset) {
                this.showMessage("package.zip file not found", "error");
                return;
            }
            
            this.showMessage(`Downloading ${pluginAsset.name} (${this.formatFileSize(pluginAsset.size)})`, "info");
            
            // 使用 GitHub 下载 URL
            const downloadUrl = pluginAsset.browser_download_url;
            
            console.log("downloadUrl", downloadUrl);
            const { success, packageType } = await this.downloadAndInstallPlugin(downloadUrl, pluginAsset.name, enable);
            
            if (success) {
                console.log(`Package downloaded and installed successfully!${enable && packageType === "plugin" ? ' Auto-enabled.' : ' Please enable the package manually.'}`);
            } else {
                console.error("Failed to download or install package");
            }
            
        } catch (error) {
            console.error("InstallPackage error:", error);
            this.showMessage(`Download failed: ${error.message}`, "error");
        }
    }

    /**
     * 获取仓库信息
     */
    private async getRepositoryInfo(owner: string, repo: string): Promise<any> {
        try {
            const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error("Failed to get repository information:", error);
            return null;
        }
    }

    /**
     * 获取 Release 信息
     */
    private async getReleaseInfo(owner: string, repo: string, version: string): Promise<any> {
        try {
            let url: string;
            if (version) {
                // 获取指定版本的 Release
                url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`;
            } else {
                // 获取最新 Release
                url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
            }
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error("Failed to get Release information:", error);
            return null;
        }
    }

    /**
     * 查找包文件 - 只允许查找 package.zip 文件
     */
    private findPluginAsset(assets: any[]): any {
        if (!assets || !Array.isArray(assets)) {
            return null;
        }
        
        // 只查找 package.zip 文件
        const file = assets.find(asset => 
            asset.name.toLowerCase() === 'package.zip'
        );
        
        return file || null;
    }


    /**
     * 下载并安装插件
     */
    private async downloadAndInstallPlugin(downloadUrl: string, fileName: string, enable: boolean): Promise<{ success: boolean, packageType: string | null }> {
        try {
            console.log("Downloading file from GitHub...");
            
            // 创建 AbortController 用于超时控制
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 秒超时
            
            let response: Response;
            try {
                // 下载文件到内存
                response = await fetch(downloadUrl, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`Download failed: HTTP ${response.status}`);
                }
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new Error('Download timeout, please check network connection');
                }
                throw error;
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // 验证文件
            if (!this.validatePluginFile(uint8Array, fileName)) {
                this.showMessage("File validation failed, please check if the file is complete.", "error");
                return { success: false, packageType: null };
            }
            
            console.log("File validation passed, detecting package type...");
            
            // 检测包类型（基于配置文件存在性）
            let packageType: string | null;
            try {
                packageType = await this.detectPackageType(uint8Array, fileName);
            } catch (error) {
                this.showMessage(`Package type detection failed: ${error.message}`, "error");
                return { success: false, packageType: null };
            }
            
            if (!packageType) {
                this.showMessage("Unable to identify package type, please ensure the package contains the correct configuration file (one of plugin.json, widget.json, template.json, theme.json, icon.json).", "error");
                return { success: false, packageType: null };
            }
            
            console.log(`Package type detected: ${packageType}, installing...`);
            
            // 使用 SiYuan 内核 API 进行安装
            const success = await this.installPackageWithKernelAPI(uint8Array, fileName, packageType, enable);
            
            if (success) {
                this.showMessage(`${packageType} package installed successfully${enable && packageType === "plugin" ? ', auto-enabled.' : ', please enable manually.'}`, "info");
            } else {
                this.showMessage("Package installation failed", "error");
            }
            
            return { success, packageType };
        } catch (error) {
            console.error("Failed to download or install plugin:", error);
            this.showMessage(`Installation failed: ${error.message}`, "error");
            return { success: false, packageType: null };
        }
    }

    /**
     * 验证包文件 - 只验证 package.zip 文件
     */
    private validatePluginFile(data: Uint8Array, fileName: string): boolean {
        try {
            // 检查文件大小
            if (data.length === 0) {
                console.error("File size is 0");
                return false;
            }
            
            // 检查文件名必须是 package.zip
            if (fileName.toLowerCase() !== 'package.zip') {
                console.error("File name must be package.zip");
                return false;
            }
            
            // 验证 ZIP 文件头
            // ZIP 文件头通常是 "PK" (0x504B)
            if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4B) {
                return true;
            } else {
                console.error("ZIP file header validation failed");
                return false;
            }
        } catch (error) {
            console.error("File validation failed:", error);
            return false;
        }
    }

    /**
     * 检测包类型 - 基于配置文件存在性
     */
    private async detectPackageType(data: Uint8Array, fileName: string): Promise<string | null> {
        try {
            // 先解压到临时目录进行检测
            const tempFileName = `temp_${Date.now()}_${fileName}`;
            const tempPath = `temp/${tempFileName}`;
            
            // 写入临时文件
            await this.writeTempFile(data, tempPath);
            
            // 解压到临时目录
            const extractPath = `temp/extract_${Date.now()}`;
            await this.unzipFile(tempPath, extractPath);
            
            // 检测包类型
            const packageType = await this.detectPackageTypeFromContent(extractPath);
            
            // 清理临时文件
            await this.cleanupTempFiles([tempPath, extractPath]);
            
            return packageType;
        } catch (error) {
            console.error('Failed to detect package type:', error);
            return null;
        }
    }

    /**
     * 通过解压后的内容检测包类型 - 必须只包含一种配置文件
     */
    private async detectPackageTypeFromContent(extractPath: string): Promise<string | null> {
        try {
            console.log(`Checking extracted directory: ${extractPath}`);
            
            // 使用 readDir API 获取解压后的文件列表
            const dirResponse = await fetch('/api/file/readDir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: extractPath
                })
            });
            
            if (!dirResponse.ok) {
                throw new Error(`Unable to read extracted directory: ${dirResponse.status}`);
            }
            
            const dirData = await dirResponse.json();
            console.log('Extracted directory contents:', dirData);
            
            if (!dirData.data || !Array.isArray(dirData.data)) {
                throw new Error('Extracted directory is empty or format is incorrect');
            }
            
            // 获取文件名列表
            const fileNames = dirData.data.map((item: any) => item.name || item);
            console.log('File list:', fileNames);
            
            // 检查是否存在特定的配置文件
            const configFiles = [
                { file: 'plugin.json', type: 'plugin' },
                { file: 'widget.json', type: 'widget' },
                { file: 'template.json', type: 'template' },
                { file: 'theme.json', type: 'theme' },
                { file: 'icon.json', type: 'icon' }
            ];
            
            const foundConfigs: string[] = [];
            
            for (const config of configFiles) {
                if (fileNames.includes(config.file)) {
                    foundConfigs.push(config.type);
                    console.log(`Found configuration file: ${config.type}`);
                }
            }
            
            console.log('Found configuration files:', foundConfigs);
            
            // 必须只包含一种配置文件
            if (foundConfigs.length === 0) {
                throw new Error('No configuration files found (plugin.json, widget.json, template.json, theme.json, icon.json)');
            } else if (foundConfigs.length > 1) {
                throw new Error(`Multiple configuration files found: ${foundConfigs.join(', ')}, a package can only contain one type of configuration file`);
            }
            
            return foundConfigs[0];
        } catch (error) {
            console.warn('Failed to detect package type from content:', error);
            throw error;
        }
    }

    /**
     * 使用 SiYuan 内核 API 安装包
     */
    private async installPackageWithKernelAPI(data: Uint8Array, fileName: string, packageType: string, enable: boolean): Promise<boolean> {
        let tempPath = '';
        let extractPath = '';
        
        try {
            console.log(`Starting package installation: ${fileName}, type: ${packageType}`);
            
            // 创建临时文件
            const tempFileName = `temp_${Date.now()}_${fileName}`;
            tempPath = `temp/${tempFileName}`;
            console.log(`Creating temporary file: ${tempPath}`);
            
            // 使用 SiYuan 的文件 API 写入临时文件
            await this.writeTempFile(data, tempPath);
            console.log(`Temporary file written successfully: ${tempPath}`);
            
            // 解压到临时目录
            extractPath = `temp/extract_${Date.now()}`;
            console.log(`Extracting to directory: ${extractPath}`);
            await this.unzipFile(tempPath, extractPath);
            console.log(`Extraction completed: ${extractPath}`);
            
            // 检查解压后的内容
            const extractDirResponse = await fetch('/api/file/readDir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: extractPath
                })
            });
            
            if (extractDirResponse.ok) {
                const extractDirData = await extractDirResponse.json();
                console.log('Extracted directory contents:', extractDirData);
            }
            
            // 根据包类型安装到对应目录 - 包名必须从配置文件中提取
            const packageName = await this.extractPackageNameFromContent(extractPath, packageType);
            console.log(`Package name extracted from configuration file: ${packageName}`);
            
            const installPath = this.getInstallPath(packageType, packageName);
            console.log(`Final package name: ${packageName}`);
            console.log(`Target installation path: ${installPath}`);
            
            // 检查目标目录是否已存在
            if (await this.pathExists(installPath)) {
                console.log(`Target directory already exists: ${installPath}`);
                this.showMessage(`Target directory ${installPath} already exists, clearing old package files...`, "info");
                
                // 清空已存在的目录
                await this.clearDirectory(installPath);
                console.log(`Cleared old package files: ${installPath}`);
            } else {
                console.log(`Target directory does not exist: ${installPath}`);
            }
            
            // 复制文件到安装目录
            console.log(`Starting to copy files from ${extractPath} to ${installPath}`);
            await this.copyToInstallPath(extractPath, installPath);
            console.log(`File copy completed: ${installPath}`);
            
            // 验证安装结果
            const installDirResponse = await fetch('/api/file/readDir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: installPath
                })
            });
            
            if (installDirResponse.ok) {
                const installDirData = await installDirResponse.json();
                console.log('Post-installation directory contents:', installDirData);
            } else {
                console.error(`Unable to verify installation result: ${installDirResponse.status}`);
            }
            
            // 根据启用状态设置包的状态
            console.log(`Attempting to ${enable ? 'enable' : 'disable'} package: ${packageType} - ${packageName}`);
            await this.setPackageEnabled(packageType, packageName, enable);
            
            console.log(`Package installed successfully: ${packageName}`);
            return true;
        } catch (error) {
            console.error("Package installation failed:", error);
            this.showMessage(`Installation failed: ${error.message}`, "error");
            return false;
        } finally {
            // 确保清理临时文件
            if (tempPath || extractPath) {
                console.log(`Cleaning up temporary files: ${tempPath}, ${extractPath}`);
                await this.cleanupTempFiles([tempPath, extractPath].filter(Boolean));
            }
        }
    }

    /**
     * 检查路径是否存在
     */
    private async pathExists(path: string): Promise<boolean> {
        try {
            const response = await fetch('/api/file/readDir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: path
                })
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * 写入临时文件
     */
    private async writeTempFile(data: Uint8Array, path: string): Promise<void> {
        console.log(`Writing temporary file: ${path}, data size: ${data.length} bytes`);
        
        // 创建 FormData 对象
        const formData = new FormData();
        
        // 将 Uint8Array 转换为 Blob
        const blob = new Blob([data], { type: 'application/octet-stream' });
        
        // 创建文件名（从路径中提取）
        const fileName = path.split('/').pop() || 'temp_file';
        
        // 添加到 FormData
        formData.append('file', blob, fileName);
        formData.append('path', path);
        
        console.log(`FormData prepared: file=${fileName}, path=${path}`);
        
        // 使用 SiYuan 的文件 API
        const response = await fetch('/api/file/putFile', {
            method: 'POST',
            body: formData
        });
        
        console.log(`Write temporary file response: ${response.status} ${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to write temporary file: ${response.status} - ${errorText}`);
            throw new Error(`Failed to write temporary file: ${response.status} - ${errorText}`);
        }
        
        console.log(`Temporary file written successfully: ${path}`);
    }

    /**
     * 解压文件
     */
    private async unzipFile(zipPath: string, extractPath: string): Promise<void> {
        console.log(`Unzipping file: ${zipPath} -> ${extractPath}`);
        
        const response = await fetch('/api/archive/unzip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                zipPath: zipPath,
                path: extractPath
            })
        });
        
        console.log(`Unzip file response: ${response.status} ${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to unzip file: ${response.status} - ${errorText}`);
            throw new Error(`Failed to unzip file: ${response.status} - ${errorText}`);
        }
        
        console.log(`File unzipped successfully: ${zipPath} -> ${extractPath}`);
    }

    /**
     * 获取安装路径
     */
    private getInstallPath(packageType: string, packageName: string): string {
        switch (packageType) {
            case 'plugin':
                return `data/plugins/${packageName}`;
            case 'widget':
                return `data/widgets/${packageName}`;
            case 'template':
                return `data/templates/${packageName}`;
            case 'theme':
                return `conf/appearance/themes/${packageName}`;
            case 'icon':
                return `conf/appearance/icons/${packageName}`;
            default:
                return `data/plugins/${packageName}`;
        }
    }

    /**
     * 从解压后的内容中提取包名 - 必须从配置文件中获取
     */
    private async extractPackageNameFromContent(extractPath: string, packageType: string): Promise<string> {
        try {
            console.log(`Extracting package name from content: ${extractPath}, type: ${packageType}`);
            
            // 根据包类型读取对应的配置文件
            const configFile = this.getConfigFileName(packageType);
            const configPath = `${extractPath}/${configFile}`;
            
            console.log(`Reading configuration file: ${configPath}`);
            
            const response = await fetch('/api/file/getFile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: configPath
                })
            });
            
            if (response.status !== 200) {
                throw new Error(`Unable to read configuration file ${configFile}: ${response.status}`);
            }
            
            const configData = await response.json();
            console.log(`Configuration file content:`, configData);
            
            // 从配置文件中提取包名
            const packageName = configData.name || configData.packageName;
            
            if (!packageName) {
                throw new Error(`Package name not found in configuration file (name or packageName field)`);
            }
            
            console.log(`Package name extracted from configuration file: ${packageName}`);
            
            // 验证包名格式
            if (typeof packageName !== 'string' || packageName.trim() === '') {
                throw new Error(`Invalid package name format: ${packageName}`);
            }
            
            return packageName.trim();
        } catch (error) {
            console.error('Failed to extract package name from content:', error);
            throw new Error(`Unable to extract package name from configuration file: ${error.message}`);
        }
    }

    /**
     * 获取配置文件名称
     */
    private getConfigFileName(packageType: string): string {
        switch (packageType) {
            case 'plugin':
                return 'plugin.json';
            case 'widget':
                return 'widget.json';
            case 'template':
                return 'template.json';
            case 'theme':
                return 'theme.json';
            case 'icon':
                return 'icon.json';
            default:
                return 'plugin.json';
        }
    }

    /**
     * 复制到安装路径（使用 globalCopyFiles API）
     */
    private async copyToInstallPath(sourcePath: string, targetPath: string): Promise<void> {
        console.log(`Starting to copy directory: ${sourcePath} -> ${targetPath}`);
        
        // globalCopyFiles API 要求:
        // - srcs: 绝对路径数组
        // - destDir: 相对路径（会自动拼接工作空间路径）
        
        // 将相对路径转换为绝对路径
        // 假设工作空间路径在 window.siyuan.config.system.workspaceDir
        const workspaceDir = window.siyuan?.config?.system?.workspaceDir || '';
        const absoluteSourcePath = workspaceDir ? `${workspaceDir}/${sourcePath}` : sourcePath;
        
        // 提取目标路径的父目录（destDir 参数）
        const lastSlashIndex = targetPath.lastIndexOf('/');
        const destDir = lastSlashIndex > 0 ? targetPath.substring(0, lastSlashIndex) : '';
        const targetDirName = lastSlashIndex > 0 ? targetPath.substring(lastSlashIndex + 1) : targetPath;
        
        console.log(`Workspace directory: ${workspaceDir}`);
        console.log(`Absolute source path: ${absoluteSourcePath}`);
        console.log(`Target parent directory: ${destDir}`);
        console.log(`Target directory name: ${targetDirName}`);
        
        // 使用 globalCopyFiles API 复制整个目录
        const response = await fetch('/api/file/globalCopyFiles', { // 这个 API 应该只能支持桌面端后端
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                srcs: [absoluteSourcePath],  // 绝对路径数组
                destDir: destDir               // 相对路径
            })
        });
        
        console.log(`Copy directory response: ${response.status} ${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to copy directory: ${response.status} - ${errorText}`);
            throw new Error(`Failed to copy directory: ${response.status} - ${errorText}`);
        }
        
        const responseData = await response.json();
        console.log(`Copy directory response data:`, responseData);
        
        if (responseData.code !== 0) {
            throw new Error(`Failed to copy directory: ${responseData.msg}`);
        }
        
        // globalCopyFiles 会保留源目录名，需要重命名为目标目录名
        const sourceDirName = sourcePath.split('/').pop() || sourcePath;
        const tempTargetPath = `${destDir}/${sourceDirName}`;
        
        console.log(`Temporary target path: ${tempTargetPath}`);
        console.log(`Final target path: ${targetPath}`);
        
        // 如果源目录名和目标目录名不同，需要重命名
        if (sourceDirName !== targetDirName) {
            console.log(`Renaming directory: ${tempTargetPath} -> ${targetPath}`);
            await this.renameDirectory(tempTargetPath, targetPath);
        }
        
        console.log(`Directory copy successful: ${sourcePath} -> ${targetPath}`);
    }

    /**
     * 重命名目录
     */
    private async renameDirectory(oldPath: string, newPath: string): Promise<void> {
        console.log(`Renaming directory: ${oldPath} -> ${newPath}`);
        
        // 检查目标路径是否已存在
        if (await this.pathExists(newPath)) {
            console.log(`Target path already exists: ${newPath}, deleting it first`);
            await this.clearDirectory(newPath);
            console.log(`Cleared target path: ${newPath}`);
        }
        
        const response = await fetch('/api/file/renameFile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                path: oldPath,
                newPath: newPath
            })
        });
        
        console.log(`Rename response: ${response.status} ${response.ok}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to rename directory: ${response.status} - ${errorText}`);
            throw new Error(`Failed to rename directory: ${response.status} - ${errorText}`);
        }
        
        const responseData = await response.json();
        console.log(`Rename response data:`, responseData);
        
        if (responseData.code !== 0) {
            throw new Error(`Failed to rename directory: ${responseData.msg}`);
        }
        
        console.log(`Directory renamed successfully: ${oldPath} -> ${newPath}`);
    }

    /**
     * 删除目录（包括非空目录）
     */
    private async clearDirectory(dirPath: string): Promise<void> {
        try {
            console.log(`Starting to delete directory: ${dirPath}`);
            
            // 首先检查目录是否存在
            if (!(await this.pathExists(dirPath))) {
                console.log(`Directory does not exist: ${dirPath}, no need to delete`);
                return;
            }
            
            // 直接删除目录（包括非空目录）
            console.log(`Deleting directory: ${dirPath}`);
            await this.removeFileOrDirectory(dirPath);
            console.log(`Directory deleted successfully: ${dirPath}`);
        } catch (error) {
            console.error(`Failed to delete directory: ${dirPath}`, error);
            throw new Error(`Failed to delete directory: ${error.message}`);
        }
    }

    /**
     * 删除文件或目录
     */
    private async removeFileOrDirectory(path: string): Promise<void> {
        try {
            const response = await fetch('/api/file/removeFile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: path
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`Delete failed: ${path} - ${response.status} - ${errorText}`);
                throw new Error(`Delete failed: ${response.status} - ${errorText}`);
            }
            
            console.log(`Delete successful: ${path}`);
        } catch (error) {
            console.error(`Failed to delete file/directory: ${path}`, error);
            throw error;
        }
    }

    /**
     * 清理临时文件
     */
    private async cleanupTempFiles(paths: string[]): Promise<void> {
        for (const path of paths) {
            try {
                const response = await fetch('/api/file/removeFile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        path: path
                    })
                });
                
                if (!response.ok) {
                    console.warn(`Failed to clean up temporary file: ${path}`);
                }
            } catch (error) {
                console.warn(`Failed to clean up temporary file: ${path}`, error);
            }
        }
    }

    /**
     * 设置包启用状态
     */
    private async setPackageEnabled(packageType: string, packageName: string, enabled: boolean): Promise<void> {
        try {
            // 根据包类型调用相应的 API
            switch (packageType) {
                case 'plugin':
                    // 使用 setPetalEnabled API 设置插件启用状态
                    const action = enabled ? 'enable' : 'disable';
                    console.log(`Attempting to ${action} plugin: ${packageName}`);
                    fetchPost('/api/petal/setPetalEnabled', {
                        packageName: packageName,
                        enabled: enabled,
                        frontend: getFrontend()
                    }, (response) => {
                        if (response.code === 0) {
                            console.log(`Plugin ${packageName} ${action}d successfully`);
                            this.showMessage(`Plugin ${packageName} has been ${action}d`, "info");
                            
                            // 插件状态变更后需要刷新 UI 以确保插件正确加载/卸载
                            setTimeout(() => {
                                this.showReloadDialog(packageName, action);
                            }, 1000);
                        } else {
                            console.error(`Failed to ${action} plugin: ${response.msg}`);
                            this.showMessage(`Failed to ${action} plugin: ${response.msg}`, "error");
                        }
                    });
                    break;
                default:
                    // 其他包类型不需要启用/禁用功能
                    console.log(`${packageType} ${packageName} installed`);
                    this.showMessage(`${packageType} ${packageName} installed`, "info");
            }
        } catch (error) {
            const action = enabled ? 'enable' : 'disable';
            console.error(`Failed to ${action} package:`, error);
            this.showMessage(`Failed to ${action} package: ${error.message}`, "error");
        }
    }

    /**
     * 显示刷新对话框
     */
    private showReloadDialog(packageName: string, action: string): void {
        const dialog = new Dialog({
            title: "Plugin Status Change",
            content: 
`<div class="b3-dialog__content">
    <div>Plugin ${packageName} has been ${action}d</div>
    <div class="b3-label__text">To ensure the plugin works properly, it is recommended to refresh the interface. Refresh now?</div>
</div>
<div class="b3-dialog__action">
    <button data-type="cancel" class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
    <div class="fn__space"></div>
    <button data-type="confirm" class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            width: "400px"
        });

        dialog.element.querySelector('[data-type="cancel"]').addEventListener('click', () => {
            dialog.destroy();
        });

        dialog.element.querySelector('[data-type="confirm"]').addEventListener('click', () => {
            dialog.destroy();
            // 使用 reloadUI API 刷新界面
            fetchPost('/api/system/reloadUI');
        });
    }

    /**
     * 格式化文件大小
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 显示消息提示
     */
    private showMessage(message: string, type: 'info' | 'error' = 'info') {
        // 使用 SiYuan 的消息提示 API
        showMessage(this.displayName + ": " + message, 10000, type);
        // if (type === 'info') {
        //     console.log(message);
        // } else {
        //     console.error(message);
        // }
    }
}

function isMobile() {
    return !!window.siyuan.mobile;
}