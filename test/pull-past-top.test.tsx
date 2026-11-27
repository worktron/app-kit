import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { PULL_PAST, pullPastTopTakes, usePullPastTop } from '../web/pull-past-top';

// The pull past the top on the page's own scroll and on a box's, with touches dispatched as a finger's reach the page.
// web/e2e/pull-past-top.e2e.ts makes the same pulls with a real finger in Chromium, where the page really scrolls.

let place = 0;

beforeEach(() => {
  place = 0;
  Object.defineProperty(window, 'scrollY', { get: () => place, configurable: true });
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  delete (window as { scrollY?: unknown }).scrollY;
});

/** A touch event from `target` with one finger at x, y (two with `fingers: 2`); touchend has none down. */
function touch(type: string, target: EventTarget, x = 0, y = 0, fingers = 1) {
  const event = new Event(type, { bubbles: true });
  const touches = type === 'touchend' ? [] : Array.from({ length: fingers }, () => ({ clientX: x, clientY: y }));
  Object.defineProperty(event, 'touches', { value: touches });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** A finger landing on `target`, moving by dx, dy in steps, and lifting. */
function drag(target: EventTarget, dy: number, dx = 0, fingers = 1) {
  touch('touchstart', target, 100, 100, fingers);
  for (let i = 1; i <= 10; i++) touch('touchmove', target, 100 + (dx * i) / 10, 100 + (dy * i) / 10, fingers);
  touch('touchend', target);
}

/** Long enough for the page to have come to rest and the pull to act: more frames than it waits for. */
async function rest() {
  for (let i = 0; i < 8; i++) await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

type Where = 'window' | 'box';

/** A page with the pull on the window's scroll, or on a box of its own (`#box`), with a row (`#row`) to touch. */
function Page({ where, on = true, act: run, box = true, extra = '' }: { where: Where; on?: boolean; act: () => void; box?: boolean; extra?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const past = usePullPastTop({ on, act: run, scroller: where === 'box' ? scroller : undefined });
  const inner = (
    <>
      <p id="line">{past ? 'Release for earlier messages' : 'Show earlier messages'}</p>
      <p id="row">The newest message</p>
      <div dangerouslySetInnerHTML={{ __html: extra }} />
    </>
  );
  if (where === 'window') return <main>{inner}</main>;
  return box ? (
    <div id="box" ref={scroller}>
      {inner}
    </div>
  ) : (
    <main>{inner}</main>
  );
}

const row = () => document.querySelector('#row')!;
const line = () => document.querySelector('#line')!.textContent;

for (const where of ['window', 'box'] as const) {
  /** Sets where the page is scrolled to: the window's place, or the box's scrollTop. */
  const scrollTo = (y: number) => {
    if (where === 'window') place = y;
    else Object.defineProperty(document.querySelector('#box')!, 'scrollTop', { value: y, configurable: true });
  };

  test(`on the ${where}'s scroll, a pull of 40 points past the top opens nothing, and 110 opens once, after the page rests`, async () => {
    const opened = mock(() => {});
    render(<Page where={where} act={opened} />);
    drag(row(), 40);
    await rest();
    expect(opened).not.toHaveBeenCalled();
    drag(row(), 110);
    expect(opened).not.toHaveBeenCalled();
    await rest();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  test(`on the ${where}'s scroll, the line says a release opens them once the drag is past the pull`, () => {
    render(<Page where={where} act={() => {}} />);
    touch('touchstart', row(), 100, 100);
    touch('touchmove', row(), 100, 100 + PULL_PAST - 10);
    expect(line()).toBe('Show earlier messages');
    touch('touchmove', row(), 100, 100 + PULL_PAST + 10);
    expect(line()).toBe('Release for earlier messages');
    touch('touchcancel', row());
    expect(line()).toBe('Show earlier messages');
  });

  test(`on the ${where}'s scroll, a drag that starts below the top counts from where the page reaches it`, async () => {
    const opened = mock(() => {});
    render(<Page where={where} act={opened} />);
    scrollTo(300);
    touch('touchstart', row(), 100, 100);
    touch('touchmove', row(), 100, 200);
    touch('touchmove', row(), 100, 300);
    // The page reaches its top here; 60 points more is short of the pull.
    scrollTo(0);
    touch('touchmove', row(), 100, 310);
    touch('touchmove', row(), 100, 370);
    expect(line()).toBe('Show earlier messages');
    touch('touchmove', row(), 100, 400);
    expect(line()).toBe('Release for earlier messages');
    touch('touchend', row());
    await rest();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  test(`on the ${where}'s scroll, a released pull waits for iOS's spring back to end at the top, however slow its end`, async () => {
    const opened = mock(() => {});
    render(<Page where={where} act={opened} />);
    drag(row(), 110);
    // The stretch's last fraction of a point, still for longer than the rest the pull waits for.
    scrollTo(-0.3);
    await rest();
    expect(opened).not.toHaveBeenCalled();
    scrollTo(0);
    await rest();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  test(`on the ${where}'s scroll, a flick that reaches the top only after the finger lifts opens nothing`, async () => {
    const opened = mock(() => {});
    render(<Page where={where} act={opened} />);
    scrollTo(400);
    drag(row(), 300);
    // The page coasts on to its top after the lift.
    scrollTo(0);
    await rest();
    expect(opened).not.toHaveBeenCalled();
  });

  test(`on the ${where}'s scroll, a drag more sideways than down, or with two fingers, or while there is nothing to open, never opens`, async () => {
    const opened = mock(() => {});
    const { rerender } = render(<Page where={where} act={opened} />);
    drag(row(), 150, 200);
    drag(row(), 150, 0, 2);
    rerender(<Page where={where} act={opened} on={false} />);
    drag(row(), 150);
    await rest();
    expect(opened).not.toHaveBeenCalled();
  });

  test(`on the ${where}'s scroll, a drag that starts in a dialog, a menu or a list scrolled inside the page never opens`, async () => {
    const opened = mock(() => {});
    render(
      <Page
        where={where}
        act={opened}
        extra={'<div role="dialog"><p id="in-dialog">A sheet</p></div><div role="menu"><p id="in-menu">An item</p></div><div id="list"><p id="in-list">A row in a list</p></div>'}
      />,
    );
    Object.defineProperty(document.querySelector('#list')!, 'scrollTop', { value: 40, configurable: true });
    for (const id of ['#in-dialog', '#in-menu', '#in-list']) {
      const target = document.querySelector(id)!;
      expect(pullPastTopTakes(target)).toBe(false);
      drag(target, 150);
    }
    await rest();
    expect(opened).not.toHaveBeenCalled();
    expect(pullPastTopTakes(row())).toBe(true);
  });
}

test('a pull takes a touch only while it would open something, and on the box it watches', () => {
  const { rerender } = render(
    <>
      <Page where="box" act={() => {}} />
      <p id="outside">Beside the box</p>
    </>,
  );
  expect(pullPastTopTakes(row())).toBe(true);
  expect(pullPastTopTakes(document.querySelector('#outside'))).toBe(false);
  rerender(<Page where="box" act={() => {}} on={false} />);
  expect(pullPastTopTakes(row())).toBe(false);
  cleanup();
  expect(pullPastTopTakes(document.body)).toBe(false);
});

test('a pull whose box is not drawn yet watches nothing and takes nothing, never the window', async () => {
  const opened = mock(() => {});
  const { rerender } = render(<Page where="box" box={false} act={opened} />);
  expect(pullPastTopTakes(row())).toBe(false);
  drag(row(), 150);
  await rest();
  expect(opened).not.toHaveBeenCalled();
  // Drawn later, it is watched from then.
  rerender(<Page where="box" act={opened} />);
  expect(pullPastTopTakes(row())).toBe(true);
  drag(row(), 150);
  await rest();
  expect(opened).toHaveBeenCalledTimes(1);
});

test('the line goes back to its words once there is nothing to open', () => {
  const { rerender } = render(<Page where="window" act={() => {}} />);
  touch('touchstart', row(), 100, 100);
  touch('touchmove', row(), 100, 100 + PULL_PAST + 10);
  expect(screen.getByText('Release for earlier messages')).toBeTruthy();
  rerender(<Page where="window" act={() => {}} on={false} />);
  expect(screen.getByText('Show earlier messages')).toBeTruthy();
});
