"use strict";

const gulp = require('gulp');
const Vinyl = require('vinyl');
const del = require('del');
const sass = require('gulp-sass');
const autoprefixer = require('gulp-autoprefixer');
const cssmin = require('gulp-cssmin');
const php = require('gulp-connect-php');
const browserSync = require('browser-sync').create();
const concat = require('gulp-concat');
//const minify = require('gulp-minify');
const uglify = require('gulp-uglify');
const rename = require('gulp-rename');
const imagemin = require('gulp-imagemin');
const fs = require('fs');

function clean() {
    return del(['./dist/**/mdb*.{css,js}', './dist/img/**/*.{png,jpg,svg,gif}']);
}

function cssCompile() {
    return gulp.src('scss/*.scss')
        .pipe(sass({outputStyle: 'nested'}).on('error', sass.logError))
        .pipe(autoprefixer({
            browsers: ['last 10 versions'],
            cascade: false
        }))
        .pipe(gulp.dest('./dist/css/'));
}

function cssCompileModules() {
    return gulp.src('scss/**/modules/**/*.scss')
        .pipe(sass({outputStyle: 'nested'}).on('error', sass.logError))
        .pipe(autoprefixer({
            browsers: ['last 10 versions'],
            cascade: false
        }))
        .pipe(rename({ dirname: './css/modules/' }))
        .pipe(gulp.dest('./dist/'));
}

function cssMinify(){
    return gulp.src(['./dist/css/*.css', '!./dist/css/*.min.css', '!./dist/css/bootstrap.css'])
        .pipe(cssmin())
        .pipe(rename({suffix: '.min'}))
        .pipe(gulp.dest('./dist/css/'));
}

function cssMinifyModules(){
    return gulp.src(['./dist/css/modules/*.css', '!./dist/css/modules/*.min.css'])
        .pipe(cssmin())
        .pipe(rename({suffix: '.min'}))
        .pipe(gulp.dest('./dist/css/modules'));
}

function getJSModules() {
    delete require.cache[require.resolve('./js/modules.js')];
    return require('./js/modules');
}

function jsBuild(){
    const plugins = getJSModules();
    return gulp.src(plugins.modules)
        .pipe(concat('mdb.js'))
        .pipe(gulp.dest('./dist/js'));
}

function jsMinify(){
    return gulp.src('./dist/js/mdb.js')
        .pipe(uglify())
        .pipe(rename({suffix: '.min'})) 
        .pipe(gulp.dest('./dist/js'));
}

function imgCompression(){
    return gulp.src('./img/**/*')
        .pipe(imagemin([
            imagemin.gifsicle({interlaced: true}),
            imagemin.jpegtran({progressive: true}),
            imagemin.optipng({optimizationLevel: 5}),
            imagemin.svgo({
                plugins: [
                    {removeViewBox: true},
                    {cleanupIDs: false}
                ]
            })
        ]))
        .pipe(gulp.dest('./dist/img'));
}

function browserSyncReload(done) {
    browserSync.reload();
    done();
}

function webServer(done){
    browserSync.init({
        proxy: 'localhost:8010',
       // server: {
       //     baseDir: "./dist"
       // },
        baseDir: './dist',
        open: true,
        notify: false
    });
    done();
}

function phpServer(done){
    php.server({
        base: './dist',
        port: 8010,
        keepalive: true
    });
    done();
}


const images = gulp.series(imgCompression);
const stylesCompile = gulp.parallel(cssCompile, cssCompileModules);
const stylesMinify = gulp.parallel(cssMinify, cssMinifyModules);
const styles = gulp.series(stylesCompile, stylesMinify);
const scripts = gulp.series(jsBuild, jsMinify);

const build = gulp.parallel(styles, scripts, images);
const server = gulp.series(phpServer, webServer);

function watchFiles(){
    gulp.watch('**/*', {cwd: './dist/'}, browserSyncReload);
    gulp.watch('./scss/**/*.scss', stylesCompile);
    gulp.watch(['./dist/css/**/*.css', '!./dist/css/**/*.min.css', '!./dist/css/bootstrap.css'], stylesMinify);
    gulp.watch('./js/**/*.js', scripts);
    gulp.watch('**/*', {cwd: './img/'}, images);
}

const run = gulp.series(clean, build, server, watchFiles);

exports.img     = images;
exports.css     = styles;
exports.js      = scripts;
exports.clean   = clean;
exports.build   = build;
exports.server  = server;
exports.default = run;
