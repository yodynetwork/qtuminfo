# How to Deploy yodyinfo

yodyinfo is splitted into 3 repos:
* [https://github.com/yodynetwork/yodyinfo](https://github.com/yodynetwork/yodyinfo)
* [https://github.com/yodynetwork/yodyinfo-api](https://github.com/yodynetwork/yodyinfo-api)
* [https://github.com/yodynetwork/yodyinfo-ui](https://github.com/yodynetwork/yodyinfo-ui)

## Prerequisites

* node.js v12.0+
* mysql v8.0+
* redis v5.0+

## Deploy yody core
1. `git clone --recursive https://github.com/yodynetwork/yody.git --branch=yodyinfo`
2. Follow the instructions of [https://github.com/yodynetwork/yody/blob/master/README.md#building-yody-core](https://github.com/yodynetwork/yody/blob/master/README.md#building-yody-core) to build yody
3. Run `yodyd` with `-logevents=1` enabled

## Deploy yodyinfo
1. `git clone https://github.com/yodynetwork/yodyinfo.git`
2. `cd yodyinfo && npm install`
3. Create a mysql database and import [docs/structure.sql](structure.sql)
4. Edit file `yodyinfo-node.json` and change the configurations if needed.
5. `npm run dev`

It is strongly recommended to run `yodyinfo` under a process manager (like `pm2`), to restart the process when `yodyinfo` crashes.

## Deploy yodyinfo-api
1. `git clone https://github.com/yodynetwork/yodyinfo-api.git`
2. `cd yodyinfo-api && npm install`
3. Create file `config/config.prod.js`, write your configurations into `config/config.prod.js` such as:
    ```javascript
    exports.security = {
        domainWhiteList: ['http://example.com']  // CORS whitelist sites
    }
    // or
    exports.cors = {
        origin: '*'  // Access-Control-Allow-Origin: *
    }

    exports.sequelize = {
        logging: false  // disable sql logging
    }
    ```
    This will override corresponding field in `config/config.default.js` while running.
4. `npm start`

## Deploy yodyinfo-ui
This repo is optional, you may not deploy it if you don't need UI.
1. `git clone https://github.com/yodynetwork/yodyinfo-ui.git`
2. `cd yodyinfo-ui && npm install`
3. Edit `package.json` for example:
   * Edit `script.build` to `"build": "YODYINFO_API_BASE_CLIENT=/api/ YODYINFO_API_BASE_SERVER=http://localhost:3001/ YODYINFO_API_BASE_WS=//example.com/ nuxt build"` in `package.json` to set the api URL base
   * Edit `script.start` to `"start": "PORT=3000 nuxt start"` to run `yodyinfo-ui` on port 3000
4. `npm run build`
5. `npm start`
