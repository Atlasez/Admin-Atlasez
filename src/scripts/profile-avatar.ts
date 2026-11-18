export const setProfileAvatar = (
  container: HTMLElement,
  value: string,
  fallbackText = "A",
) => {
  const fallback = container.querySelector<HTMLElement>(
    "[data-profile-avatar-fallback]",
  );
  if (!fallback) return;

  fallback.textContent = fallbackText;
  const source = value.trim();
  if (!source) {
    delete container.dataset.profileAvatarSource;
    container.style.backgroundImage = "";
    fallback.hidden = false;
    return;
  }

  container.dataset.profileAvatarSource = source;
  const image = new Image();
  image.onerror = () => {
    if (container.dataset.profileAvatarSource !== source) return;
    fallback.hidden = false;
  };
  fallback.hidden = true;
  image.src = source;
  const cssSource = source
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\a ")
    .replaceAll("\r", "\\d ")
    .replaceAll("\f", "\\c ");
  container.style.backgroundImage = `url("${cssSource}")`;
  container.style.backgroundSize = "cover";
  container.style.backgroundPosition = "50% 50%";
  container.style.backgroundRepeat = "no-repeat";
};
