import child_process from "child_process"
const fs = require("fs")
const path = require("path")
const zmq = require("zeromq")
const { fromEvent } = require("rxjs")
const rpcDaemon = require('@arqma/arqma-rpc').RPCDaemon
const axios = require('axios').default
const https = require('https')

export class Daemon {
    constructor (backend) {
        this.backend = backend
        this.heartbeat = null
        this.heartbeat_slow = null
        this.id = 0
        this.testnet = false
        this.local = false // do we have a local daemon ?

        this.daemon_info = {}
        this.dealer = {}
        this.zmq_enabled = false
        this.agent = new https.Agent({ keepAlive: true, maxSockets: 1})
        
    }

    checkVersion () {
        return new Promise((resolve, reject) => {
            if (process.platform === "win32") {
                let arqmad_path = path.join(__arqma_bin, "arqmad.exe")
                let arqmad_version_cmd = `"${arqmad_path}" --version`
                if (!fs.existsSync(arqmad_path)) { resolve(false) }
                child_process.exec(arqmad_version_cmd, (error, stdout, stderr) => {
                    if (error) { resolve(false) }
                    resolve(stdout)
                })
            } else {
                let arqmad_path = path.join(__arqma_bin, "arqmad")
                let arqmad_version_cmd = `"${arqmad_path}" --version`
                if (!fs.existsSync(arqmad_path)) { resolve(false) }
                child_process.exec(arqmad_version_cmd, { detached: true }, (error, stdout, stderr) => {
                    if (error) { resolve(false) }
                    resolve(stdout)
                })
            }
        })
    }

    async checkRemoteHeight () {
        // console.log('>>>>>>>>>>>>>>>>>checkRemoteHeight')
        let options = {
            method: "GET",
            headers: {
                "Accept": "application/json"
            },
            agent: this.agent,
            url: "https://explorer.arqma.com/api/networkinfo"
        }
        if (this.testnet) {
            options.url = "https://stageblocks.arqma.com/api/networkinfo"
        }
        try {
            const getInfoData = await axios(requestOptions)
            if (this.blocks.current)
                this.remote_height = getInfoData.data.height
            else
                this.remote_height = 0
        }
        catch (error) {
            console.log(`daemon.checkRemoteHeight ${error}`)
            this.remote_height = 0
        }
    }

    checkRemoteDaemon (options) {
        //console.log('>>>>>>>>>>>>>>>>>checkRemoteDaemon')
        if (options.daemon.type === "local") {
            return new Promise((resolve, reject) => {
               resolve({
                   result:  {
                        mainnet: !options.app.testnet,
                        testnet: options.app.testnet
                    }
               })
            })
        } else {
            try {
                let url = `http://${options.daemons[options.app.net_type].remote_host}:${options.daemons[options.app.net_type].remote_port}`
                let remoteDaemon = rpcDaemon.createDaemonClient({url})
                return remoteDaemon.getInfo()
            }
            catch (error) {
                console.log(`daemon.checkRemoteDaemon ${error}`)
                return {}
            }
        }
    }

    start (options) {
        //console.log('>>>>>>>>>>>>>>>>>start')
        if (options.daemon.type === "remote") {
            this.local = false
            
            // save this info for later RPC calls
            this.protocol = "http://"
            // this.hostname = options.daemon.remote_host
            // this.port = options.daemon.remote_port
            this.hostname = options.daemons[options.app.net_type].remote_host
            this.port = options.daemons[options.app.net_type].remote_port

            this.rpcDaemon = rpcDaemon.createDaemonClient({url: `${this.protocol}${this.hostname}:${this.port}`})

            return new Promise(async(resolve, reject) => {
                try {
                    await this.rpcDaemon.getInfo()
                    this.startHeartbeat()
                    resolve()
                }
                catch (error) {
                    reject()
                }
                return
            })
        }
        return new Promise((resolve, reject) => {
            this.local = true

            const args = [
                "--data-dir", options.app.data_dir,
                "--out-peers", options.daemon.out_peers,
                "--in-peers", options.daemon.in_peers,
                "--limit-rate-up", options.daemon.limit_rate_up,
                "--limit-rate-down", options.daemon.limit_rate_down,
                "--log-level", options.daemon.log_level,
                "--rpc-bind-ip", options.daemon.rpc_bind_ip,
                "--rpc-bind-port", options.daemon.rpc_bind_port
            ]

            if (options.daemon.type === "local_zmq") {
                args.push("--zmq-enabled",
                    "--zmq-max_clients", 5,
                    "--zmq-bind-port",
                    options.daemon.zmq_bind_port)
            }

            this.zmq_enabled = options.daemon.type === "local_zmq"

            if (options.daemon.enhanced_ip_privacy) {
                args.push(
                    "--p2p-bind-ip", "127.0.0.1",
                    "--p2p-bind-port", options.daemon.p2p_bind_port,
                    "--no-igd",
                    "--hide-my-port"
                )
            } else {
                args.push(
                    "--p2p-bind-ip", options.daemon.p2p_bind_ip,
                    "--p2p-bind-port", options.daemon.p2p_bind_port
                )
            }

            if (options.app.testnet) {
                this.testnet = true
                args.push("--testnet")
                args.push("--log-file", path.join(options.app.data_dir, "testnet", "logs", "arqmad.log"))
                // args.push("--add-peer", "45.77.68.151:13310")
            } else {
                args.push("--log-file", path.join(options.app.data_dir, "logs", "arqmad.log"))
            }

            if (options.daemon.rpc_bind_ip !== "127.0.0.1") { args.push("--confirm-external-bind") }

            if (options.daemon.type === "local_remote" && !options.app.testnet) {
                args.push(
                    "--bootstrap-daemon-address",
                    `${options.daemon.remote_host}:${options.daemon.remote_port}`
                )
            }

            if (process.platform === "win32") {
                this.daemonProcess = child_process.spawn(path.join(__arqma_bin, "arqmad.exe"), args)
            } else {
                this.daemonProcess = child_process.spawn(path.join(__arqma_bin, "arqmad"), args, {
                    detached: true
                })
            }

            // save this info for later RPC calls
            this.protocol = "http://"
            this.hostname = options.daemon.rpc_bind_ip
            this.port = options.daemon.rpc_bind_port

            this.daemonProcess.on("error", err => process.stderr.write(`Daemon: ${err}\n`))
            this.daemonProcess.on("close", code => process.stderr.write(`Daemon: exited with code ${code}\n`))

            try {
                this.rpcDaemon = rpcDaemon.createDaemonClient({url: `${this.protocol}${this.hostname}:${this.port}`})
            } 
            catch (error) {
                console.log(`daemon.start ${error}`)
            }

            if (options.daemon.type !== "local_zmq") {
                this.daemonProcess.stdout.on("data", data => process.stdout.write(`Daemon: ${data}`))

                // To let caller know when the daemon is ready
                let intrvl = setInterval(async() => {
                    try {
                        const result = await this.rpcDaemon.getInfo()
                        clearInterval(intrvl)
                        this.startHeartbeat()
                        resolve()
                    }
                    catch (error) {}
                }, 2000)
            } else {
                this.checkRemoteHeight()
                this.startZMQ(options)
                let getinfo = { "jsonrpc": "2.0",
                    "id": "1",
                    "method": "get_info",
                    "params": {} }
                this.dealer.send(["", JSON.stringify(getinfo)])
                resolve()
            }
        })
    }

    randomBetween (min, max) {
        return Math.floor(Math.random() * (max - min) + min)
    }

    randomString () {
        var source = "abcdefghijklmnopqrstuvwxyz"
        var target = []
        for (var i = 0; i < 20; i++) {
            target.push(source[this.randomBetween(0, source.length)])
        }
        return target.join("")
    }

    startZMQ (options) {
        this.dealer = zmq.socket("dealer")
        this.dealer.identity = this.randomString()
        this.dealer.connect(`tcp://${options.daemon.rpc_bind_ip}:${options.daemon.zmq_bind_port}`)
        console.log(`Daemon Dealer connected to port ${options.daemon.rpc_bind_ip}:${options.daemon.zmq_bind_port}`)
        const zmqDirector = fromEvent(this.dealer, "message")
        zmqDirector.subscribe(x => {
            let daemon_info = {
            }
            let json = JSON.parse(x.toString())
            json.result.info.isDaemonSyncd = false
            daemon_info.info = json.result.info
            this.daemon_info = daemon_info
            if (json.result.info.height === json.result.info.target_height && json.result.info.height >= this.remote_height) {
                json.result.info.isDaemonSyncd = true
            }

            this.sendGateway("set_daemon_data", daemon_info)
        })
    }

    handle (value) {
        let params = value.data
        switch (value.method) {
        case "ban_peer":
            this.banPeer(params.host, params.seconds)
            break
        case "get_peers":
            clearInterval(this.heartbeat_slow)
            if (params.enabled) {
                this.heartbeat_slow = setInterval(() => {
                    this.heartbeatSlowAction()
                }, 10 * 1000) // 30 seconds
                this.heartbeatSlowAction()
            }
            break
        default:
        }
    }

    async banPeer (host, seconds = 3600) {
        // console.log('>>>>>>>>>>>>>>>>>banPeer')
        if (!seconds) { seconds = 3600 }

        let params = {
            bans: [{
                host,
                seconds,
                ban: true
            }]
        }

        try {
            await this.rpcDaemon.setBans(params)
        }
        catch (error) {
            this.sendGateway("show_notification", { type: "negative", message: "Error banning peer", timeout: 2000 })
            return
        }

        let end_time = new Date(Date.now() + seconds * 1000).toLocaleString()
        this.sendGateway("show_notification", { message: "Banned " + host + " until " + end_time, timeout: 2000 })

        // Send updated peer and ban list
        this.heartbeatSlowAction()
    }

    timestampToHeight (timestamp, pivot = null, recursion_limit = null) {
        // console.log('>>>>>>>>>>>>>>>>>timestampToHeight')
        return new Promise(async(resolve, reject) => {
            if (timestamp > 999999999999) {
                // We have got a JS ms timestamp, convert
                timestamp = Math.floor(timestamp / 1000)
            }

            pivot = pivot || [137500, 1528073506]
            recursion_limit = recursion_limit || 0

            let diff = Math.floor((timestamp - pivot[1]) / 120)
            let estimated_height = pivot[0] + diff

            if (estimated_height <= 0) {
                return resolve(0)
            }

            if (recursion_limit > 10) {
                return resolve(pivot[0])
            }

            let blockHeaderByHeightData = {}
            let failed = false
            try {
                blockHeaderByHeightData = await this.rpcDaemon.getBlockHeaderByHeight({ height: estimated_height })
            }
            catch (error) {
                failed = true
            }
            if (failed) {
                try {
                blockHeaderByHeightData = await this.rpcDaemon.getLastBlockHeader()
                }
                catch (error) {
                    return reject()
                }
            }

            let new_pivot = [blockHeaderByHeightData.result.block_header.height, blockHeaderByHeightData.result.block_header.timestamp]

            // If we are within an hour that is good enough
            // If for some reason there is a > 1h gap between blocks
            // the recursion limit will take care of infinite loop
            if (Math.abs(timestamp - new_pivot[1]) < 3600) {
                return resolve(new_pivot[0])
            }

            // Continue recursion with new pivot
            resolve(new_pivot)

        }).then((pivot_or_height) => {
            return Array.isArray(pivot_or_height)
                ? this.timestampToHeight(timestamp, pivot_or_height, recursion_limit + 1)
                : pivot_or_height
        }).catch(error => {
            return false
        })
    }

    async startHeartbeat () {
        clearInterval(this.heartbeat)
        this.heartbeat = setInterval(async() => {
            await this.heartbeatAction()
        }, this.local ? 5 * 1000 : 30 * 1000) // 5 seconds for local daemon, 30 seconds for remote
        await this.heartbeatAction()
    }

    async heartbeatAction () {   
        // console.log('>>>>>>>>>>>>>>>>>heartbeatAction')
        let daemon_info = {}
        try {
            daemon_info.info = await this.rpcDaemon.getInfo()
            this.daemon_info = daemon_info.info
        }
        catch (error) {
            console.log(error)
        }

        this.sendGateway("set_daemon_data", daemon_info)
    }

    async heartbeatSlowAction (daemon_info = {}) {
        // console.log('>>>>>>>>>>>>>>>>>heartbeatSlowAction')
        try {
            let heartbeatSlowActionData = []
            if (this.local) {
                heartbeatSlowActionData = [
                    await this.rpcDaemon.getConnections(),
                    await this.rpcDaemon.getBans()
                ]
            } 
            // console.log(JSON.stringify(heartbeatSlowActionData, null, '\t'))
            for (let n of heartbeatSlowActionData) {
                if ('connections' in n) {
                    daemon_info.connections = n.connections
                } else if ('bans' in n ) {
                    daemon_info.bans = n.bans
                } 
            }
        }
        catch (error) {
            
        }
        this.sendGateway("set_daemon_data", daemon_info)
    }

    sendGateway (method, data) {
        // if (data)
            this.backend.send(method, data)
    }

    quit () {
        // console.log('>>>>>>>>>>>>>>>>>quit')
        // TODO force close after few seconds!
        clearInterval(this.heartbeat)
        if (this.zmq_enabled && this.dealer) {
            this.dealer.send(["", "EVICT"])
            this.dealer.close()
            this.dealer = null
        }

        return new Promise((resolve, reject) => {
            if (this.daemonProcess) {
                this.daemonProcess.on("close", code => {
                    if (this.agent) {
                        this.agent.destroy()
                    }
                    resolve()
                })
                this.daemonProcess.kill()
            } else {
                resolve()
            }
        })
    }
}
