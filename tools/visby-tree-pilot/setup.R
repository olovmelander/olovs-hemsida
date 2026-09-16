# Windows binary environment, isolated from the user's R library.
args <- commandArgs(trailingOnly=TRUE)
root <- if(length(args)) args[1] else "output/visby-tree-pilot/toolchain"
lib <- file.path(root, "library")
dir.create(lib, recursive=TRUE, showWarnings=FALSE)
.libPaths(c(normalizePath(lib), .Library))
options(repos=c(rlidar="https://r-lidar.r-universe.dev", CRAN="https://cloud.r-project.org"), timeout=600)
packages <- c("lidR", "terra", "sf", "jsonlite")
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly=TRUE)]
if(length(missing)) {
  if("--resolve" %in% args) {
    install.packages(missing, lib=lib, type="binary", destdir=root)
  } else {
    # Verify archive SHA-256 with toolchain.py before restoring this cache.
    source("tools/visby-tree-pilot/toolchain-lock.R")
    archives <- file.path(root,pinned_archives)
    stopifnot(all(file.exists(archives)))
    install.packages(archives, repos=NULL, lib=lib, type="win.binary")
  }
}
stopifnot(all(vapply(packages, requireNamespace, logical(1), quietly=TRUE)))
lock <- list(R=R.version.string, platform=R.version$platform,
             packages=as.data.frame(installed.packages(lib.loc=lib)[,c("Package","Version","Built")]),
             sources=c("https://r-lidar.r-universe.dev/bin/windows/contrib/4.5/", "https://cloud.r-project.org/bin/windows/contrib/4.5/"),
             note="Resolved binary packages and their downloaded archives are pinned by toolchain-lock.json SHA-256 entries.")
jsonlite::write_json(lock, file.path(root,"installed.json"),pretty=TRUE,auto_unbox=TRUE)
print(vapply(packages, function(x)as.character(packageVersion(x)), character(1)))
