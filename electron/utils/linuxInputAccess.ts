/**
 * Linux stealth typing reads the keyboard from /dev/input (evdev), which is
 * `root:input 0660`. The app never uses sudo and never runs as root; the user
 * grants access once, outside the app. The text offers a narrow udev rule first
 * and the `input` group second, because the group is keylogger-equivalent for
 * every process of that user. Pure so it tests on any OS.
 */
export type LinuxInputAccess = 'ok' | 'permission-denied' | 'no-devices';

export function linuxInputAccessHelp(access: LinuxInputAccess | string, user = '$USER'): string | null {
  switch (access) {
    case 'ok':
      return null;
    case 'permission-denied':
      return (
        'Stealth typing needs read access to your keyboard (/dev/input).\n' +
        'Recommended: a narrow udev rule that grants ONE keyboard to your seat, e.g. ' +
        '/etc/udev/rules.d/90-natively-keyboard.rules with\n' +
        '  SUBSYSTEM=="input", KERNEL=="event*", ENV{ID_INPUT_KEYBOARD}=="1", TAG+="uaccess"\n' +
        'then run: sudo udevadm control --reload && sudo udevadm trigger.\n' +
        'Alternative: sudo usermod -aG input ' + user + ' and log out and back in. ' +
        'Be aware that this lets EVERY process running as you read ALL keyboards ' +
        '(passwords included): it is keylogger-equivalent access. Prefer the udev rule.\n' +
        'Natively never runs these commands or uses sudo itself, and never runs as root.'
      );
    case 'no-devices':
      return 'No keyboard device was found under /dev/input (a container or VM without input passthrough).';
    default:
      return 'Stealth typing is unavailable: the native keyboard module is missing from this build.';
  }
}
