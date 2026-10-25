/** A screen in its own file, so its code loads only when it is opened, as a deploy can leave it missing. */
export default function Later() {
  return <p>The later screen</p>;
}
