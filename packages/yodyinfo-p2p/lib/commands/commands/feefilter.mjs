import {BufferReader, BufferWriter} from 'qtuminfo-lib'
import Message from './message'

export default class FeeFilterMessage extends Message {
  constructor({feeRate, ...options}) {
    super('feefilter', options)
    this.feeRate = feeRate
  }

  get payload() {
    let writer = new BufferWriter()
    writer.writeUInt64LE(this.feeRate)
    return writer.toBuffer()
  }

  set payload(payload) {
    let reader = new BufferReader(payload)
    this.feeRate = reader.readUInt64LE()
    Message.checkFinished(reader)
  }
}
