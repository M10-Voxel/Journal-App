"""Explicit download for the isolated evaluation. Never imported by the production app."""
import base64
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
import zipfile

REVISION = "3de2c11f55853b7919f985a59bfc8df27b5ec991"
REPOSITORY = "jugaadsrl/gliner2.5-multi-v1-onnx"
ROOT = Path(__file__).resolve().parents[2] / "src-tauri" / "target" / "mail-ml-assets"


def download(url, destination, size_limit):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Journal-Mail-ML-Evaluation/1"})
    with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as output:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > size_limit:
                raise ValueError("Download exceeds the expected size")
            output.write(block)
    temporary.replace(destination)


def valid_model_file(path, metadata):
    if not path.is_file() or path.stat().st_size != metadata["size"]:
        return False
    digest = hashlib.sha256() if metadata.get("lfs") else hashlib.sha1()
    if not metadata.get("lfs"):
        digest.update(f"blob {metadata['size']}\0".encode())
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    expected = metadata["lfs"]["sha256"] if metadata.get("lfs") else metadata["blobId"]
    return digest.hexdigest() == expected


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    metadata_url = f"https://huggingface.co/api/models/{REPOSITORY}/revision/{REVISION}?blobs=true"
    with urllib.request.urlopen(metadata_url, timeout=30) as response:
        metadata = json.load(response)
    if metadata["sha"] != REVISION:
        raise ValueError("Unexpected model revision")
    files = [item for item in metadata["siblings"] if item["rfilename"].startswith("fp32_25/")]
    if not files or sum(item["size"] for item in files) > 1_300_000_000:
        raise ValueError("Unexpected model file list")
    for item in sorted(files, key=lambda file: -file["size"]):
        name = item["rfilename"]
        if ".." in Path(name).parts:
            raise ValueError("Invalid model path")
        destination = ROOT / name
        if valid_model_file(destination, item):
            print("Verified cached", name, flush=True)
            continue
        print("Downloading", name, item["size"], "bytes", flush=True)
        download(f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{urllib.parse.quote(name)}", destination, item["size"])
        if not valid_model_file(destination, item):
            raise ValueError(f"Model hash mismatch: {name}")
        print("Verified", name, flush=True)
    package_url = "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.23.2/microsoft.ml.onnxruntime.1.23.2.nupkg"
    package = ROOT / "microsoft.ml.onnxruntime.1.23.2.nupkg"
    # Published SHA512 from Microsoft's NuGet catalog entry for this exact version.
    expected = base64.b64decode("sVAnmG5xfi4JW7YU70jY6z4kSWaCt39tnyRHnqy7QlLIHA4RZ+mBBnzKUKAjhJYyTyPDPy92Wui7MY/kFgs2mA==")
    if not package.is_file() or hashlib.sha512(package.read_bytes()).digest() != expected:
        print("Downloading official Microsoft CPU runtime", flush=True)
        download(package_url, package, 250_000_000)
    if hashlib.sha512(package.read_bytes()).digest() != expected:
        raise ValueError("Runtime package hash mismatch")
    with zipfile.ZipFile(package) as archive:
        for name in ["runtimes/win-x64/native/onnxruntime.dll", "runtimes/win-x64/native/onnxruntime_providers_shared.dll"]:
            if name.endswith("_providers_shared.dll") and name not in archive.namelist():
                continue
            destination = ROOT / "runtime" / Path(name).name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(name))
        for name in archive.namelist():
            if name.upper().startswith(("LICENSE", "THIRD")):
                (ROOT / "runtime" / Path(name).name).write_bytes(archive.read(name))
    print("Evaluation assets ready in", ROOT, flush=True)


if __name__ == "__main__":
    main()
