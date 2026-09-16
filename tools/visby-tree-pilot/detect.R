# Actual lidR implementations, on the same measured 1 m CHM used by Node.
args <- commandArgs(trailingOnly=TRUE)
root <- if(length(args)) args[1] else "output/visby-tree-pilot"
.libPaths(c(normalizePath(file.path(root,"toolchain/library")), .Library))
suppressPackageStartupMessages({library(lidR);library(terra);library(sf);library(jsonlite)})
set_lidr_threads(2L)
scenes <- fromJSON(file.path(root,"scenes.json"),simplifyVector=FALSE)
source <- rast(file.path(root,"chm.tif"))
dir.create(file.path(root,"detections"),showWarnings=FALSE)
for(scene in scenes) {
  # 20 m processing halo; score only the interior. Adjacent crowns affect maxima.
  half <- scene$size/2+20
  chm <- crop(source,ext(scene$easting-half,scene$easting+half,scene$northing-half,scene$northing+half),snap="out")
  values(chm) <- values(chm)
  for(smoothing in c(0,1)) {
    detection <- if(smoothing==1) focal(chm,w=3,fun=median,na.rm=TRUE) else chm
    for(base in c(3,4,5)) {
      # lidR lmf takes a DIAMETER. The Node detector explicitly takes a radius.
      window <- function(h)pmin(10,pmax(3,base+0.1*h))
      tops <- locate_trees(detection,lmf(window,hmin=3))
      for(method in c("dalponte","silva")) {
        name <- paste0(method,"-d",base,"-s",smoothing)
        fn <- if(method=="dalponte")dalponte2016(detection,tops,th_tree=2,th_seed=.45,th_cr=.55,max_cr=10) else silva2016(detection,tops,max_cr_factor=.6,exclusion=.3)
        labels <- fn()
        # No point cloud is fabricated: these are labelled canopy raster cells.
        writeRaster(labels,file.path(root,"detections",paste0(scene$id,"-",name,".tif")),overwrite=TRUE,datatype="INT4S",NAflag=-1)
      }
    }
  }
  cat("lidR completed",scene$id,"\n")
}
write_json(list(R=R.version.string,lidR=as.character(packageVersion("lidR")),terra=as.character(packageVersion("terra")),sf=as.character(packageVersion("sf")),
  input="measured 1 m canopy raster, not synthetic LAS",windowUnits="diameter in metres",heightMinimum=3,processingHaloMetres=20),file.path(root,"detections/lidr-run.json"),pretty=TRUE,auto_unbox=TRUE)
