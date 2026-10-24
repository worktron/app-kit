import { expect, test } from 'bun:test'
import { frame, Unframer } from '../host/native.ts'

test('messages survive framing, split across chunks or run together', () => {
  const one = frame({ type: 'hello', version: '0.1.0' })
  const two = frame({ type: 'answer', id: 'r1', text: 'é'.repeat(1000) })
  const all = new Uint8Array([...one, ...two])
  const unframer = new Unframer()
  expect(unframer.push(all.subarray(0, 3))).toEqual([])
  expect(unframer.push(all.subarray(3, one.length + 10))).toEqual([{ type: 'hello', version: '0.1.0' }])
  expect(unframer.push(all.subarray(one.length + 10))).toEqual([{ type: 'answer', id: 'r1', text: 'é'.repeat(1000) }])
})

test('the length is four bytes, little-endian, of the UTF-8 body', () => {
  const framed = frame({ a: 'é' })
  expect(new DataView(framed.buffer).getUint32(0, true)).toBe(new TextEncoder().encode('{"a":"é"}').length)
})
