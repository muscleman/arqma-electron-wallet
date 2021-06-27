/**
 * arqma-electron-wallet
 * https://github.com/arqma/arqma-electron-wallet
 *
 * market.js
 *
 **/

const axios = require('axios').default
const https = require('https')

export class Market {
    constructor (backend) {
        this.backend = backend
        this.heartbeat_slow = null
        this.id = 0

        this.agent = new https.Agent({ keepAlive: true, maxSockets: 1 })
        this.options = null
        this.endpoint = "/api/v3/coins/arqma/tickers"
    }

    start (options) {
        return new Promise((resolve, reject) => {
            this.options = options
            resolve()
        })
    }

    handle (data) {
        switch (data.method) {
        case "open_wallet":
            this.startHeartbeat()
            break
        case "close_wallet":
            clearInterval(this.heartbeat)
            clearInterval(this.heartbeat_slow)
            break
        default:
        }
    }

    startHeartbeat () {
        clearInterval(this.heartbeat_slow)
        this.heartbeat_slow = setInterval(() => {
            this.heartbeatSlowAction()
        }, 2 * 60 * 1000) // 2 minutes
        this.heartbeatSlowAction()
    }

    async heartbeatSlowAction () {
        try {
            
            let requestOptions = {
                url: `${this.options.market.exchange.protocol}${this.options.market.exchange.hostname}:${this.options.market.exchange.port}${this.options.market.exchange.endpoint}`,
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                agent: this.agent
            }
            // console.log(`market.heartbeatSlowAction ${JSON.stringify(requestOptions, null, '\t')}`)
                          
            let response = await axios(requestOptions)
            let data = []
            for (let ticker of response.data.tickers) {
                let key = ticker.market.name
                let symbol = ticker.target // btc
                let label = `${key} ${symbol}`
                let price = +ticker.last
                if (price === 0) continue
                data.push({ key: label, label: label, symbol: symbol, value: price })
            }
            this.sendGateway("set_market_data", { info: { exchanges: data } })
        } catch (error) {}
    }

    sendGateway (method, data) {
        this.backend.send(method, data)
    }

    quit () {
        clearInterval(this.heartbeat)
        clearInterval(this.heartbeat_slow)
        return new Promise((resolve, reject) => {
            resolve()
        })
    }
}
