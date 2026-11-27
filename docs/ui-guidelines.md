# FileKit UI guidelines

## Layout and type

- Use a 4 px spacing scale. Use 4–8 px within controls, 8–12 px between related fields, and 16 px for card padding and gaps between cards.
- Keep the preview and thumbnail strip in the wider desktop column. Stack cards on small screens. Keep the thumbnail strip horizontally scrollable and let important labels and filenames wrap.
- Use Inter at 14 px for body text and controls, 12 px for helper text, and 16 px for card headings. Use 27–39 px for the workspace title. Set body line height to 1.5. Align values at the trailing edge of label–value pairs and use tabular figures for dimensions, counts, and percentages.
- Use the monochrome theme tokens in `app/globals.css`. Reserve red for errors. Check WCAG AA contrast in both color schemes.

## Controls and feedback

- Use the shared buttons, tabs, choice controls, progress bars, and notices. Use one filled primary action per panel and outline or ghost buttons for other actions. Give remove actions an explicit name and a distinct icon.
- Give icon-only controls an accessible name and tooltip. Keep keyboard focus visible and restore it after inline editing or closing menus. Provide a keyboard equivalent for pointer actions. Use a minimum 44 px touch target and honor reduced motion.
- Use an info notice for temporary context, a warning for output changes or device limits, and an error for a failed action. State what happened, what to expect, or what to try in plain language. Show progress for running work. Keep one notice per issue and offer dismissal when the information remains available elsewhere.
- Check 360, 768, 1024, 1280, and 1440 px in both themes. Include empty, loaded, busy, and error states when a layout or control changes.
