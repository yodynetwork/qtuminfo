# How to deploy yodyinfo and yodyinfo-ui

## Prerequisites
* node.js v10.5+
* mongodb v4.0+

## Deploy yody core
1. `git clone --recursive https://github.com/yodynetwork/yody.git --branch=yodyinfo`
2. Follow the instructions [https://github.com/yodynetwork/yody#building-yody-core]() to build yody
3. Run `yodyd` with `-logevents=1` enabled

## Deploy yodyinfo
1. `git clone https://github.com/yodynetwork/yodyinfo.git && cd yodyinfo`
2. `npm install`
3. `mkdir packages/explorer` (you may change the directory name) and write files `package.json` and `yodyinfo-node.json` to it
    ```json
    // package.json
    {
        "name": "explorer-mainnet",
        "private": true,
        "scripts": {
            "start": "yodyinfo-node start"
        },
        "dependencies": {
            "yodyinfo-api": "^0.0.1",
            "yodyinfo-node": "^0.0.1",
            "yodyinfo-ws": "^0.0.1"
        }
    }
    ```
    ```json
    // yodyinfo-node.json
    {
        "chain": "mainnet",
        "port": 3001,
        "datadir": "/absolute/path/to/yodyinfo/packages/explorer/data",
        "services": [
            "yodyinfo-api",
            "yodyinfo-ws",
            "address",
            "balance",
            "block",
            "contract",
            "db",
            "header",
            "mempool",
            "p2p",
            "transaction",
            "web"
        ],
        "servicesConfig": {
            "db": {
            "mongodb": {
                "url": "mongodb://localhost:27017/",
                "database": "yodyinfo-mainnet"
            },
            "rpc": {
                "protocol": "http",
                "host": "localhost",
                "port": 3889,
                "user": "user",
                "password": "password"
            }
            },
            "p2p": {
            "peers": [
                {
                    "ip": {
                        "v4": "127.0.0.1"
                    },
                    "port": 3888
                }
            ]
            },
            "yodyinfo-ws": {
                "port": 3002
            }
        }
    }
    ```
4. `npm run lerna bootstrap`
5. run `npm start` in `packages/explorer` directory

## Deploy yodyinfo-ui
1. `git clone https://github.com/yodynetwork/yodyinfo.git && cd yodyinfo`
2. `npm install` \
    You may modify `package.json` as follows:
    * rewrite `script.build` to `"build": "YODYINFO_API_BASE_CLIENT=/api/ YODYINFO_API_BASE_SERVER=http://localhost:3001/yodyinfo-api/ YODYINFO_API_BASE_WS=//example.com/ws/ nuxt build"` in `package.json` to set the api URL base
    * rewrite `script.start` to `"start": "PORT=12345 nuxt start"` to frontend on port 12345
3. `npm run build`
4. `npm start`
