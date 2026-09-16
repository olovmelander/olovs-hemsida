# Apply the already frozen candidate generator to separate placement-review areas.
root <- "output/visby-tree-pilot"
work <- file.path(root,"round2")
.libPaths(c(normalizePath(file.path(root,"toolchain/library")), .Library))
suppressPackageStartupMessages({library(lidR);library(terra);library(sf);library(jsonlite)})
stopifnot(as.character(packageVersion("lidR"))=="4.3.3",as.character(packageVersion("terra"))=="1.9.50")
lock <- fromJSON("geo_data/course-v2/visby/vegetation/pilot/round2/detector-lock.json")
stopifnot(lock$method=="dalponte-d9-m5",lock$maximumIslandAreaMetres2==80)
set_lidr_threads(2L)
source <- rast(file.path(root,"chm.tif"))
for(scene in fromJSON(file.path(work,"review-scenes.json"),simplifyVector=FALSE)){
 half <- scene$size/2+20
 chm <- crop(source,ext(scene$easting-half,scene$easting+half,scene$northing-half,scene$northing+half),snap="out")
 detection <- focal(chm,w=5,fun=median,na.rm=TRUE)
 tops <- locate_trees(detection,lmf(function(h)pmin(14,pmax(3,9+.1*h)),hmin=3))
 labels <- dalponte2016(detection,tops,th_tree=2,th_seed=.45,th_cr=.55,max_cr=10)()
 writeRaster(labels,file.path(work,"detections",paste0(scene$id,"-",lock$method,".tif")),overwrite=TRUE,datatype="INT4S",NAflag=-1)
 cat(scene$id,"complete\n")
}
