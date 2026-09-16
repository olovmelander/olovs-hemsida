args <- commandArgs(trailingOnly=TRUE)
root <- 'output/veckefjarden-tree-pilot'
.libPaths(c(normalizePath('output/visby-tree-pilot/toolchain/library'),.Library))
suppressPackageStartupMessages({library(lidR);library(terra);library(sf);library(jsonlite)})
stopifnot(as.character(packageVersion('lidR'))=='4.3.3',as.character(packageVersion('terra'))=='1.9.50')
set_lidr_threads(2L)
stage<-if(length(args))args[1] else 'calibration'
scenes<-fromJSON(file.path(root,'scenes.json'),simplifyVector=FALSE)
scenes<-Filter(function(s)s$split==stage,scenes)
source<-rast(file.path(root,'chm.tif'))
dir.create(file.path(root,'detections'),recursive=TRUE,showWarnings=FALSE)
for(scene in scenes){
 half<-scene$size/2+20
 chm<-crop(source,ext(scene$easting-half,scene$easting+half,scene$northing-half,scene$northing+half),snap='out')
 detection<-focal(chm,w=3,fun=median,na.rm=TRUE)
 for(base in c(5,7,9)){
  window<-function(h)pmin(14,pmax(3,base+.1*h))
  tops<-locate_trees(detection,lmf(window,hmin=3))
  for(method in c('dalponte','silva')){
   name<-paste0(method,'-d',base,'-m3')
   fn<-if(method=='dalponte')dalponte2016(detection,tops,th_tree=2,th_seed=.45,th_cr=.55,max_cr=10) else silva2016(detection,tops,max_cr_factor=.6,exclusion=.3)
   writeRaster(fn(),file.path(root,'detections',paste0(scene$id,'-',name,'.tif')),overwrite=TRUE,datatype='INT4S',NAflag=-1)
  }
 }
 cat(stage,scene$id,'complete\n')
}
write_json(list(stage=stage,R=R.version.string,lidR=as.character(packageVersion('lidR')),terra=as.character(packageVersion('terra')),
 minimumHeight=3,haloMetres=20,median=3,bases=c(5,7,9),window='clamp(base + 0.1h, 3, 14)'),file.path(root,paste0(stage,'-tool-run.json')),pretty=TRUE,auto_unbox=TRUE)
