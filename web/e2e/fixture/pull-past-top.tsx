import { StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PullToRefresh, usePullPastTop } from '../..';

// A conversation opened on its newest message, its earlier messages closed above it, which a pull down past the top
// opens. With ?scroll=box the page scrolls inside a box of its own; otherwise the page's own scroll. Pull to refresh is
// mounted too, so a test sees it stand aside while the pull would open something. It counts its loads in the tab, as
// pieces.tsx does, and its opens on the page.

const loads = Number(sessionStorage.getItem('pull-past-top-loads') ?? 0) + 1;
sessionStorage.setItem('pull-past-top-loads', String(loads));
const inBox = new URLSearchParams(location.search).get('scroll') === 'box';

const paragraphs = (who: string, count: number) => Array.from({ length: count }, (_, i) => <p key={i}>{`${who}, paragraph ${i + 1}.`}</p>);

function Conversation() {
  const box = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [opens, setOpens] = useState(0);
  // Where the newest message's top was before the earlier ones were drawn above it, so it stays there.
  const was = useRef<number | null>(null);
  const show = () => {
    was.current = newest.current!.getBoundingClientRect().top;
    setOpens((n) => n + 1);
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (was.current === null) return;
    const by = newest.current!.getBoundingClientRect().top - was.current;
    was.current = null;
    if (inBox) box.current!.scrollTop += by;
    else window.scrollBy(0, by);
  }, [open]);
  const past = usePullPastTop({ on: !open, act: show, scroller: inBox ? box : undefined });
  const content = (
    <main style={{ padding: '0 16px 32px' }}>
      <p id="opens">{opens}</p>
      <p id="loads">{loads}</p>
      {!open && (
        <button id="line" type="button" onClick={show} style={{ minHeight: 44 }}>
          {past ? 'Release for earlier messages' : 'Show earlier messages'}
        </button>
      )}
      {open && <div id="earlier">{paragraphs('An earlier message', 30)}</div>}
      <div id="newest" ref={newest}>
        {paragraphs('The newest message', 60)}
      </div>
    </main>
  );
  return (
    <>
      {inBox ? (
        <div id="box" ref={box} style={{ height: '100dvh', overflowY: 'auto', overscrollBehaviorY: 'contain' }}>
          {content}
        </div>
      ) : (
        content
      )}
      <PullToRefresh />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Conversation />
  </StrictMode>,
);
