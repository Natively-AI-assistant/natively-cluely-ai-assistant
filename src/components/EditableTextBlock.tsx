import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';

interface EditableTextBlockProps {
    initialValue: string;
    onSave: (value: string) => void;
    tagName?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    onEnter?: () => void;
    autoFocus?: boolean;
}

const EditableTextBlock: React.FC<EditableTextBlockProps> = ({
    initialValue,
    onSave,
    tagName = 'div',
    className = '',
    placeholder = 'Type here...',
    multiline = true,
    onEnter,
    autoFocus = false
}) => {
    const [isEditing, setIsEditing] = useState(autoFocus); // Start editing if autoFocus is true
    const [localValue, setLocalValue] = useState(initialValue);
    const contentRef = useRef<HTMLElement>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // The DOM text is written only here, never rendered as a React child: while
    // editing the browser owns the text node. A child would be re-reconciled
    // whenever a debounced save changed initialValue mid-edit, rewriting the
    // node under the caret and throwing it back to the start of the field.
    // Layout effect so the text is there on first paint; the mount run also
    // covers autoFocus, which starts in edit mode.
    const mountedRef = useRef(false);
    useLayoutEffect(() => {
        if (!isEditing || !mountedRef.current) {
            mountedRef.current = true;
            setLocalValue(initialValue);
            if (contentRef.current && contentRef.current.innerText !== initialValue) {
                contentRef.current.innerText = initialValue;
            }
        }
    }, [initialValue, isEditing]);

    const handleSave = useCallback((newValue: string) => {
        const trimmed = newValue.trim();
        // Only save if changed (allow saving empty string if that's the intent, but usually we want to keep it clean)
        // If it's a list item, empty might mean delete, but for now let's just save whatever.
        if (trimmed !== initialValue) {
            onSave(trimmed);
        }
    }, [initialValue, onSave]);

    const handleChange = useCallback(() => {
        if (!contentRef.current) return;
        const newValue = contentRef.current.innerText;
        setLocalValue(newValue);

        // Debounced save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            handleSave(newValue);
        }, 600); // 600ms debounce
    }, [handleSave]);

    const handleBlur = useCallback(() => {
        setIsEditing(false);
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        if (contentRef.current) {
            handleSave(contentRef.current.innerText);
        }
    }, [handleSave]);

    const lastEnterTime = useRef<number>(0);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            // Revert
            setIsEditing(false);
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            if (contentRef.current) {
                contentRef.current.innerText = initialValue;
            }
            setLocalValue(initialValue);
        } else if (e.key === 'Enter') {
            if (!multiline) {
                e.preventDefault();
                contentRef.current?.blur();
            } else if (onEnter) {
                // Double-Enter detection (500ms threshold)
                const now = Date.now();
                if (now - lastEnterTime.current < 500) {
                    // Double-Enter detected!
                    e.preventDefault();
                    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                    if (contentRef.current) handleSave(contentRef.current.innerText);
                    onEnter();
                    lastEnterTime.current = 0; // Reset
                } else {
                    // First Enter: Allow default (newline)
                    // But track time
                    lastEnterTime.current = now;
                    // Standard newline behavior allows contentEditable to insert <div> or <br>
                    // We don't preventDefault here.
                }
            }
        }
    };

    const handleClick = () => {
        setIsEditing(true);
    };

    // Focus management
    useEffect(() => {
        if (isEditing && contentRef.current) {
            contentRef.current.focus();
            // If autoFocus was relevant (newly created), we might want cursor at start or end?
            // Standard behavior usually end, but for new empty item it doesn't matter.
        }
    }, [isEditing]);

    const Tag = tagName as any;

    return (
        <Tag
            ref={contentRef}
            contentEditable={isEditing}
            suppressContentEditableWarning={true}
            onClick={handleClick}
            onBlur={handleBlur}
            onInput={handleChange}
            onKeyDown={handleKeyDown}
            className={`
                outline-none min-w-[10px] cursor-text transition-colors duration-200
                bg-transparent
                ${!localValue && placeholder ? 'empty:before:content-[attr(data-placeholder)] empty:before:text-white/20' : ''}
                ${className}
            `}
            data-placeholder={placeholder}
            spellCheck={false} // Clean look
        />
    );
};

export default EditableTextBlock;
