from PyInstaller.utils.hooks import collect_dynamic_libs, copy_metadata


# Keep the native ORT provider/runtime libraries and exact distribution metadata
# alongside the frozen Python binding on every release platform.
binaries = collect_dynamic_libs("onnxruntime")
datas = copy_metadata("onnxruntime")
