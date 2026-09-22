import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import { isRepresentableKey } from '../../utils/keyboardUtils';

interface KeyRecorderProps {
    currentKeys: string[];
    onSave: (keys: string[]) => void;
    className?: string;
}

export const KeyRecorder: React.FC<KeyRecorderProps> = ({ currentKeys, onSave, className }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
    const inputRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isRecording && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isRecording]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation();

        const key = e.key;
        const code = e.code;
        const meta = e.metaKey;
        const ctrl = e.ctrlKey;
        const alt = e.altKey;
        const shift = e.shiftKey;

        // Ignore modifier key presses alone if possible, but we need to show them
        const modifiers = [];
        if (meta) modifiers.push('⌘');
        if (ctrl) modifiers.push('⌃');
        if (alt) modifiers.push('⌥');
        if (shift) modifiers.push('⇧');

        let mainKey = '';
        if (key !== 'Meta' && key !== 'Control' && key !== 'Alt' && key !== 'Shift') {
            if (code.startsWith('Key')) mainKey = key.toUpperCase();
            else if (code.startsWith('Digit')) mainKey = key;
            else if (code === 'Space') mainKey = 'Space';
            else if (key === 'Enter') mainKey = 'Enter';
            else if (key === 'Backspace') mainKey = 'Backspace';
            else if (key.startsWith('Arrow')) mainKey = key;
            else mainKey = key.toUpperCase();

            // Applied to the RESULT, not as a fallback branch: the Key*/Digit*
            // branches above hand back the layout's character, so on a non-US
            // layout they yield the composed glyph too (Option+4 -> "₹", and a
            // Cyrillic KeyA -> "ф"). Anything Electron cannot turn into an
            // accelerator is treated as if it were never pressed — recording
            // stays open and the existing bind stands. Letting it through would
            // collapse the combo to an empty accelerator, which is how "unbound"
            // is spelled, silently clearing the shortcut.
            if (!isRepresentableKey(mainKey)) mainKey = '';
        }

        if (mainKey) {
            setRecordedKeys([...modifiers, mainKey]);
            setIsRecording(false);
            onSave([...modifiers, mainKey]);
        } else {
            // Just modifiers pressed so far
            setRecordedKeys([...modifiers]);
        }
    };

    return (
        <div
            className={`relative flex items-center gap-1.5 group ${className || ''}`}
            onClick={() => setIsRecording(true)}
        >
            {isRecording ? (
                <div
                    ref={inputRef}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onBlur={() => setIsRecording(false)}
                    className="flex items-center gap-1 bg-bg-input border border-accent-primary text-accent-primary px-2 py-1 rounded-md text-xs font-sans shadow-sm outline-none min-w-[60px] justify-center"
                >
                    {recordedKeys.length > 0 ? recordedKeys.join(' + ') : 'Press keys...'}
                </div>
            ) : (
                <div className="flex items-center gap-1">
                    {currentKeys.map((k, i) => {
                        let displayKey = k;
                        if (k === 'ArrowUp') displayKey = '↑';
                        else if (k === 'ArrowDown') displayKey = '↓';
                        else if (k === 'ArrowLeft') displayKey = '←';
                        else if (k === 'ArrowRight') displayKey = '→';

                        return (
                            <span key={i} className="bg-bg-input text-text-secondary h-6 min-w-[26px] px-1.5 rounded-md text-xs font-sans flex items-center justify-center shadow-sm border border-border-subtle group-hover:border-text-tertiary transition-colors">
                                {displayKey}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
