'use strict'
const async = require('async')
const BitcoinWorker = require('./BitcoinWorker')
const { StatusFile } = require('blocktank-worker')
const blockConfig = require('../config/blocks.worker.config.json')

class BlockProcessor extends BitcoinWorker {
  constructor (config) {
    super(config)
    this.block_time = config.block_time || 5000
    this.min_confirmation = config.min_confirmation

    this.statusFile = new StatusFile({
      tag: 'bitcoin',
      postfix: 'blocks'
    })
  }

  async _loadState () {
    let f
    try {
      f = await this.statusFile.loadFile()
      this.current_height = f.current_height
      console.log(`Current loaded block: ${f.current_height}`)
      return
    } catch (err) {
      console.log(`Creating ${this.statusFile}`)
      await this._updateStatusFile(0)
    }
  }

  publishNewBlock (data) {
    // send messages about new block
    console.log('Current block: ', data)
    blockConfig.new_block_listeners.forEach((svc) => {
      this.gClient.send(svc, {
        method: 'onNewBlock',
        args: [data]
      })
    })
  }

  _updateStatusFile (h) {
    return this.statusFile.updateFile({ current_height: h })
  }

  getCurrentBlock (options, cb) {
    if (!this.current_height) {
      return cb(new Error('Current block height is unkown'))
    }
    cb(null, this.current_height || null)
  }

  updateHeight () {
    this.btc.getHeight({}, (err, height) => {
      if (err) throw err
      if (height > this.current_height) {
        this.current_height = this.current_height + 1
        this._updateStatusFile(this.current_height)
        this.publishNewBlock(this.current_height)
      }
    })
  }

  async getHeightTransactions ({ height }, cb) {
    console.log('Getting transactions for block: ', height)
    const blockTx = await this.getBlockData({ height })
    return new Promise((resolve, reject) => {
      async.mapLimit(blockTx.tx, 2, async (id) => {
        const tx = await this.btc.parseTransaction({ height, id })
        return this.btc.processSender(tx)
      }, (err, data) => {
        if (err) return cb(err)
        console.log('Done processing block: ', height)
        const tx = data.flat().filter(Boolean)
        this.btc.rawTxCache.clear()
        cb(null, tx)
      })
    })
  }

  async getBlockData ({ height }, cb) {
    const hash = await this.btc.getBlockHash(height)
    const block = await this.btc.getBlock(hash)
    return block
  }

  start () {
    super.start()
    this._loadState()
    this.timer = setInterval(() => {
      this.updateHeight()
    }, this.block_time)
  }
}

module.exports = BlockProcessor
