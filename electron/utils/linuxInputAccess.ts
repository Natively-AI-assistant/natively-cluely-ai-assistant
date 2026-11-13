/**
 * Linux stealth typing reads the keyboard from /dev/input (evdev), which is
 * `root:input 0660`. The app never uses sudo and never runs as root; the user
 * grants access once, outside the app. Pure so it tests on any OS.
 */
export type LinuxInputAccess = 'ok' | 'permission-denied' | 'no-devices';

export function linuxInputAccessHelp(access: LinuxInputAccess | string, user = '$USER'): string | null {
  switch (access) {
    case 'ok':
      return null;
    case 'permission-denied':
      return (
        'Stealth typing needs read access to your keyboard (/dev/input). ' +
        `Add yourself to the "input" group, then log out and back in:\n  sudo usermod -aG input ${user}\n` +
        'Or install a udev rule that grants your seat access to input devices. ' +
        'Natively itself never runs as root.'
      );
    case 'no-devices':
      return 'No keyboard device was found under /dev/input (a container or VM without input passthrough).';
    default:
      return 'Stealth typing is unavailable: the native keyboard module is missing from this build.';
  }
}
