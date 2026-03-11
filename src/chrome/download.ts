import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as unzipper from "unzipper";

const DEFAULT_CHROME_VERSION = "136.0.7103.59";

export interface ChromeDownloadOptions {
  version?: string;
  cacheDir?: string;
}

export interface ChromeInfo {
  executablePath: string;
  version: string;
}

type Platform = "mac-arm64" | "mac-x64" | "linux64" | "win64";

function getPlatform(): Platform {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "darwin") {
    return arch === "arm64" ? "mac-arm64" : "mac-x64";
  } else if (platform === "linux") {
    return "linux64";
  } else if (platform === "win32") {
    return "win64";
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

function getChromePath(extractDir: string, platform: Platform): string {
  const baseName = "chrome-headless-shell-" + platform;

  switch (platform) {
    case "mac-arm64":
    case "mac-x64":
      return path.join(extractDir, baseName, "chrome-headless-shell");
    case "linux64":
      return path.join(extractDir, baseName, "chrome-headless-shell");
    case "win64":
      return path.join(extractDir, baseName, "chrome-headless-shell.exe");
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers["content-length"] || "0", 10);
      let downloadedSize = 0;

      response.on("data", (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const percent = Math.round((downloadedSize / totalSize) * 100);
          process.stderr.write(`\rDownloading Chrome... ${percent}%`);
        }
      });

      response.pipe(file);

      file.on("finish", () => {
        file.close();
        console.error("\nDownload complete.");
        resolve();
      });
    });

    request.on("error", (err) => {
      fs.unlink(destPath, () => {}); // Delete the file on error
      reject(err);
    });

    file.on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  console.error("Extracting Chrome...");

  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on("close", () => {
        console.error("Extraction complete.");
        resolve();
      })
      .on("error", reject);
  });
}

export async function downloadChrome(
  options: ChromeDownloadOptions = {},
): Promise<ChromeInfo> {
  const version =
    options.version ||
    process.env.SQUIDLER_CHROME_VERSION ||
    DEFAULT_CHROME_VERSION;
  const cacheDir =
    options.cacheDir || path.join(os.homedir(), ".squidler", "chrome");
  const platform = getPlatform();

  // Ensure cache directory exists
  fs.mkdirSync(cacheDir, { recursive: true });

  const versionDir = path.join(cacheDir, version);
  const executablePath = getChromePath(versionDir, platform);

  // Check if already downloaded
  if (fs.existsSync(executablePath)) {
    console.error(`Using cached Chrome ${version}`);
    return { executablePath, version };
  }

  // Download URL from Chrome for Testing
  const url = `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-headless-shell-${platform}.zip`;
  const zipPath = path.join(cacheDir, `chrome-${version}-${platform}.zip`);

  console.error(`Downloading Chrome ${version} for ${platform}...`);

  try {
    await downloadFile(url, zipPath);
    await extractZip(zipPath, versionDir);

    // Clean up zip file
    fs.unlinkSync(zipPath);

    // Make executable on Unix
    if (platform !== "win64") {
      fs.chmodSync(executablePath, 0o755);
    }

    console.error(`Chrome ${version} installed at: ${executablePath}`);
    return { executablePath, version };
  } catch (error) {
    // Clean up partial downloads
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    throw error;
  }
}
