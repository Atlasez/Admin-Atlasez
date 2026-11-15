export const setProfileAvatar = (
  container: HTMLElement,
  value: string,
  fallbackText = "A",
) => {
  const image = container.querySelector<HTMLImageElement>(
    "[data-profile-avatar-image]",
  );
  const fallback = container.querySelector<HTMLElement>(
    "[data-profile-avatar-fallback]",
  );
  if (!image || !fallback) return;

  fallback.textContent = fallbackText;
  const source = value.trim();
  if (!source) {
    image.hidden = true;
    image.removeAttribute("src");
    fallback.hidden = false;
    return;
  }

  image.onerror = () => {
    if (image.getAttribute("src") !== source) return;
    image.hidden = true;
    image.removeAttribute("src");
    fallback.hidden = false;
  };
  fallback.hidden = true;
  image.hidden = false;
  if (image.getAttribute("src") !== source) image.src = source;
};
