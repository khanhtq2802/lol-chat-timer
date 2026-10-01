// Chat macro: listens for the macro key while the game is focused, and types messages in the game chat.
// Runs a hidden PowerShell process with a small C# helper (Windows APIs only, no native Node module).
const { spawn } = require('node:child_process');

const CSHARP = String.raw`
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class LolInput {
	const int WH_KEYBOARD_LL = 13;
	const uint LLKHF_INJECTED = 0x10;
	const uint INPUT_KEYBOARD = 1;
	const uint KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4, KEYEVENTF_SCANCODE = 0x8;
	const ushort SCAN_ENTER = 0x1C;
	const int VK_RETURN = 0x0D, VK_ESCAPE = 0x1B, VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
	const int MOD_CTRL = 1, MOD_SHIFT = 2, MOD_ALT = 4;

	delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

	[StructLayout(LayoutKind.Sequential)]
	struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Sequential)]
	struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
	[StructLayout(LayoutKind.Sequential)]
	struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Sequential)]
	struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
	[StructLayout(LayoutKind.Explicit)]
	struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
	[StructLayout(LayoutKind.Sequential)]
	struct INPUT { public uint type; public InputUnion u; }

	[DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
	[DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
	[DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
	[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
	[DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
	[DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
	[DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

	public static volatile int HotkeyVk = 0;
	public static volatile int HotkeyMods = 0;
	// the macro key types normally while the chat is open
	static bool chatOpen = false;
	static bool hotkeyDown = false;
	static IntPtr lastWindow = IntPtr.Zero;
	static bool lastWindowIsGame = false;
	static readonly HookProc proc = Hook;
	static readonly object output = new object();

	public static void Start() {
		var thread = new Thread(() => {
			var module = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
			SetWindowsHookEx(WH_KEYBOARD_LL, proc, module, 0);
			MSG msg;
			while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
		});
		thread.IsBackground = true;
		thread.Start();
	}

	static bool GameFocused() {
		var window = GetForegroundWindow();
		if (window != lastWindow) {
			lastWindow = window;
			uint pid;
			GetWindowThreadProcessId(window, out pid);
			try { lastWindowIsGame = Process.GetProcessById((int)pid).ProcessName == "League of Legends"; }
			catch { lastWindowIsGame = false; }
		}
		return lastWindowIsGame;
	}

	static bool Pressed(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

	static bool ModifiersMatch() {
		return Pressed(VK_CONTROL) == ((HotkeyMods & MOD_CTRL) != 0)
			&& Pressed(VK_SHIFT) == ((HotkeyMods & MOD_SHIFT) != 0)
			&& Pressed(VK_MENU) == ((HotkeyMods & MOD_ALT) != 0);
	}

	static void Emit(string line) {
		lock (output) { Console.Out.WriteLine(line); Console.Out.Flush(); }
	}

	static IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam) {
		if (nCode >= 0) {
			var key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
			int message = (int)wParam;
			bool down = message == 0x100 || message == 0x104;
			// ignore our own typing
			if ((key.flags & LLKHF_INJECTED) == 0) {
				if (!GameFocused()) {
					chatOpen = false;
				} else if (down && key.vkCode == VK_RETURN) {
					chatOpen = !chatOpen;
				} else if (down && key.vkCode == VK_ESCAPE) {
					chatOpen = false;
				} else if (HotkeyVk != 0 && key.vkCode == HotkeyVk && !chatOpen && (hotkeyDown || ModifiersMatch())) {
					// swallow the key so the game doesn't see it, fire once per press
					if (down && !hotkeyDown) Emit("hotkey");
					hotkeyDown = down;
					return (IntPtr)1;
				}
			}
		}
		return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
	}

	static INPUT Key(ushort vk, ushort scan, uint flags) {
		var input = new INPUT { type = INPUT_KEYBOARD };
		input.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
		return input;
	}

	static void Send(params INPUT[] inputs) {
		SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
	}

	static void PressEnter() {
		Send(Key(0, SCAN_ENTER, KEYEVENTF_SCANCODE), Key(0, SCAN_ENTER, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP));
	}

	// opens the team chat, types the whole text at once and sends it
	public static void TypeChat(string text) {
		if (!GameFocused()) return;
		PressEnter();
		// let the chat box open (a frame or two) before the characters arrive
		Thread.Sleep(30);
		var inputs = new INPUT[text.Length * 2];
		for (int i = 0; i < text.Length; i++) {
			inputs[i * 2] = Key(0, text[i], KEYEVENTF_UNICODE);
			inputs[i * 2 + 1] = Key(0, text[i], KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
		}
		Send(inputs);
		Thread.Sleep(15);
		PressEnter();
		// gap before the next message, so the chat doesn't merge or drop messages
		Thread.Sleep(60);
	}
}
`;

// commands on stdin: "hotkey <vk> <mods>" and "type <base64 utf-8 text>", "hotkey" on stdout when pressed
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
${CSHARP}
'@
[LolInput]::Start()
while ($null -ne ($line = [Console]::In.ReadLine())) {
	$command, $argument = $line.Split(' ', 2)
	switch ($command) {
		'hotkey' {
			$vk, $mods = $argument.Split(' ')
			[LolInput]::HotkeyVk = [int]$vk
			[LolInput]::HotkeyMods = [int]$mods
		}
		'type' { [LolInput]::TypeChat([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($argument))) }
	}
}
`;

const MAX_RESTARTS = 5;

/**
 * Starts the helper. `onHotkey` is called when the macro key is pressed in the game.
 * @param {() => void} onHotkey
 */
function startInputHelper(onHotkey) {
	/** @type {import('node:child_process').ChildProcess | null} */
	let child = null;
	let hotkey = '0 0';
	let restarts = 0;
	let stopped = false;

	function start() {
		child = spawn(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy',
				'Bypass',
				'-EncodedCommand',
				Buffer.from(SCRIPT, 'utf16le').toString('base64')
			],
			{ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
		);
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			for (const line of chunk.split(/\r?\n/)) {
				if (line.trim() === 'hotkey') onHotkey();
			}
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk) => console.error('[input helper]', chunk.trim()));
		child.on('exit', (code) => {
			child = null;
			if (stopped || restarts >= MAX_RESTARTS) return;
			restarts++;
			console.warn(`[input helper] exited with ${code}, restarting`);
			setTimeout(start, 1000);
		});
		child.stdin.write(`hotkey ${hotkey}\n`);
	}

	start();

	return {
		/** @param {number} vk Windows virtual-key code, 0 to disable @param {number} mods 1 ctrl, 2 shift, 4 alt */
		setHotkey(vk, mods) {
			hotkey = `${vk | 0} ${mods | 0}`;
			child?.stdin.write(`hotkey ${hotkey}\n`);
		},
		/** @param {string} text */
		typeChat(text) {
			child?.stdin.write(`type ${Buffer.from(text, 'utf8').toString('base64')}\n`);
		},
		stop() {
			stopped = true;
			child?.kill();
		}
	};
}

module.exports = { startInputHelper };
