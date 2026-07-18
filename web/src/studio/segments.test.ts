import { describe, it, expect } from 'vitest'
import {
  normalizeCuts,
  addCut,
  buildSegments,
  effectiveDuration,
  sourceToTimeline,
  timelineToSource,
} from './segments'

describe('normalizeCuts', () => {
  it('sorts, clamps to [0,dur] and drops empty regions', () => {
    expect(normalizeCuts([{ start: 5, end: 6 }, { start: 1, end: 2 }], 10))
      .toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }])
    expect(normalizeCuts([{ start: -3, end: 2 }], 10)).toEqual([{ start: 0, end: 2 }])
    expect(normalizeCuts([{ start: 8, end: 20 }], 10)).toEqual([{ start: 8, end: 10 }])
    expect(normalizeCuts([{ start: 4, end: 4 }], 10)).toEqual([])
  })

  it('merges overlapping and touching regions', () => {
    expect(normalizeCuts([{ start: 1, end: 4 }, { start: 3, end: 6 }], 10))
      .toEqual([{ start: 1, end: 6 }])
    expect(normalizeCuts([{ start: 1, end: 3 }, { start: 3, end: 5 }], 10))
      .toEqual([{ start: 1, end: 5 }])
  })
})

describe('addCut', () => {
  it('adds and merges a new cut into an existing set', () => {
    expect(addCut([{ start: 1, end: 2 }], { start: 5, end: 6 }, 10))
      .toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }])
    expect(addCut([{ start: 1, end: 3 }], { start: 2, end: 5 }, 10))
      .toEqual([{ start: 1, end: 5 }])
  })
})

describe('buildSegments (ripple)', () => {
  it('returns one full segment when there are no cuts', () => {
    expect(buildSegments(10, [])).toEqual([
      { srcStart: 0, srcEnd: 10, timelineStart: 0 },
    ])
  })

  it('removes a middle cut and recompacts to the left', () => {
    // cut 4..6 (2s) from a 10s track -> two kept slices, second recompacted
    expect(buildSegments(10, [{ start: 4, end: 6 }])).toEqual([
      { srcStart: 0, srcEnd: 4, timelineStart: 0 },
      { srcStart: 6, srcEnd: 10, timelineStart: 4 },
    ])
  })

  it('drops the head when a cut starts at 0', () => {
    expect(buildSegments(10, [{ start: 0, end: 3 }])).toEqual([
      { srcStart: 3, srcEnd: 10, timelineStart: 0 },
    ])
  })

  it('drops the tail when a cut ends at duration', () => {
    expect(buildSegments(10, [{ start: 7, end: 10 }])).toEqual([
      { srcStart: 0, srcEnd: 7, timelineStart: 0 },
    ])
  })

  it('handles multiple cuts', () => {
    expect(buildSegments(10, [{ start: 2, end: 3 }, { start: 6, end: 8 }])).toEqual([
      { srcStart: 0, srcEnd: 2, timelineStart: 0 },
      { srcStart: 3, srcEnd: 6, timelineStart: 2 },
      { srcStart: 8, srcEnd: 10, timelineStart: 5 },
    ])
  })

  it('returns no segments when everything is cut', () => {
    expect(buildSegments(10, [{ start: 0, end: 10 }])).toEqual([])
  })
})

describe('effectiveDuration', () => {
  it('is the source duration minus the total cut length', () => {
    expect(effectiveDuration(10, [])).toBe(10)
    expect(effectiveDuration(10, [{ start: 4, end: 6 }])).toBe(8)
    expect(effectiveDuration(10, [{ start: 2, end: 3 }, { start: 6, end: 8 }])).toBe(7)
    expect(effectiveDuration(10, [{ start: 0, end: 10 }])).toBe(0)
  })
})

describe('sourceToTimeline / timelineToSource', () => {
  const cuts = [{ start: 4, end: 6 }] // 10s track, 8s effective

  it('maps source time before a cut unchanged', () => {
    expect(sourceToTimeline(2, cuts)).toBe(2)
  })

  it('maps source time after a cut shifted left by the cut length', () => {
    expect(sourceToTimeline(8, cuts)).toBe(6)
  })

  it('maps source time inside a cut to the cut boundary on the timeline', () => {
    // anything inside 4..6 collapses to timeline position 4
    expect(sourceToTimeline(5, cuts)).toBe(4)
  })

  it('is the inverse of timelineToSource on kept regions', () => {
    expect(timelineToSource(2, cuts)).toBe(2)
    expect(timelineToSource(6, cuts)).toBe(8)
    // round-trip
    expect(sourceToTimeline(timelineToSource(3.5, cuts), cuts)).toBeCloseTo(3.5)
    expect(sourceToTimeline(timelineToSource(7, cuts), cuts)).toBeCloseTo(7)
  })
})
