# Product Tour Integration Guide

## Quick Start

### 1. Add to your App.tsx

At the top of your App.tsx, add the import:

```typescript
import { ProductTour, useContextualTip, FeatureBadge } from './components/ProductTour'
```

### 2. Add ProductTour component

Add the ProductTour component inside your main app container (before the closing `</Container>` or similar):

```tsx
function App() {
  // ... your existing code ...

  return (
    <Container>
      {/* Your existing JSX */}
      
      {/* Add Product Tour at the end */}
      <ProductTour
        onComplete={() => {
          console.log('Tour completed!')
          // Optional: Show a congratulations message
        }}
        onSkip={() => {
          console.log('Tour skipped')
          // Optional: Track analytics
        }}
      />
    </Container>
  )
}
```

### 3. Add Feature Badges (Optional)

Mark new features with a sparkle badge:

```tsx
<div style={{ position: 'relative' }}>
  <Button>New Feature</Button>
  <FeatureBadge show={true} />
</div>
```

### 4. Add Contextual Tips (Optional)

Show contextual tips when users interact with specific features:

```tsx
function MyComponent() {
  const [showTip, setShowTip] = useState(false)
  
  // Show tip when user first opens a section
  useContextualTip(
    'my-element-id',
    'Pro tip: Press Enter to save quickly!',
    showTip
  )
  
  return <div id="my-element-id">Content</div>
}
```

## Customizing Tour Steps

Edit the `TOUR_STEPS` array in `ProductTour.tsx` to customize your tour:

```typescript
const TOUR_STEPS: TourStep[] = [
  {
    target: '.your-css-selector',  // Element to highlight
    title: 'Your Title',
    description: 'Your description text',
    icon: <IconName size={24} />,  // Optional Tabler icon
    position: 'bottom',  // 'top' | 'bottom' | 'left' | 'right'
    highlight: '💡 Pro tip or important note'  // Optional highlight box
  },
  // Add more steps...
]
```

## Tour Behavior

### Automatic Start
- Tour automatically starts for new users (after 1 second delay)
- Won't show again if completed or skipped

### Manual Restart
- After completion/skip, a floating action button (FAB) appears in bottom-right
- Click to restart tour anytime

### localStorage Keys
- `hrs-tour-completed`: Set to 'true' when tour is finished
- `hrs-tour-skipped`: Set to 'true' when user skips tour

### Reset Tour (for testing)
```javascript
localStorage.removeItem('hrs-tour-completed')
localStorage.removeItem('hrs-tour-skipped')
// Refresh the page
```

## Styling

All styles are in `App.css` under the "ONBOARDING TOUR & WALKTHROUGH" section.

### Customize Colors

Change the tour theme by editing these CSS variables:

```css
/* Tour primary color */
.tour-header {
  background: linear-gradient(135deg, #4c6ef5 0%, #5c7cfa 100%);
}

.tour-btn-next {
  background: linear-gradient(135deg, #4c6ef5 0%, #5c7cfa 100%);
}

/* Finish button color */
.tour-btn-finish {
  background: linear-gradient(135deg, #40c057 0%, #51cf66 100%);
}
```

## Advanced Features

### Keyboard Navigation
Users can navigate the tour with keyboard:
- `Escape` - Skip tour
- `Arrow Right` / `Enter` - Next step
- `Arrow Left` - Previous step

### Responsive Positioning
The tooltip automatically adjusts position to stay on screen.

### Smooth Scrolling
Elements automatically scroll into view when highlighted.

### Animations
- Fade in overlay
- Scale up tooltip
- Pulse spotlight
- Progress dots transition

## Best Practices

1. **Keep it short**: 5-7 steps maximum
2. **Focus on key features**: Only highlight what's truly important
3. **Use clear language**: Avoid jargon
4. **Add visual interest**: Use emojis and icons
5. **Make it skippable**: Always allow users to skip
6. **Test thoroughly**: Try on different screen sizes

## Troubleshooting

### Tour doesn't appear
- Check console for errors
- Ensure target selectors exist in DOM
- Verify localStorage isn't blocking it

### Positioning issues
- Check if target elements are visible
- Try different `position` values
- Ensure tooltip has enough space

### Styling conflicts
- Check for z-index conflicts (tour uses 9997-9999)
- Verify no conflicting transitions
- Check dark mode compatibility

## Example: Complete Integration

```tsx
import { ProductTour, useContextualTip, FeatureBadge } from './components/ProductTour'

function App() {
  const [showNewFeatureTip, setShowNewFeatureTip] = useState(false)

  // Show tip when new feature is used
  useContextualTip(
    'export-button',
    'You can export to Excel, PDF, or CSV!',
    showNewFeatureTip
  )

  return (
    <Container>
      <Stack gap="md">
        {/* Your existing content */}
        
        <div style={{ position: 'relative' }}>
          <Button
            id="export-button"
            onClick={() => {
              setShowNewFeatureTip(true)
              handleExport()
            }}
          >
            Export Data
          </Button>
          <FeatureBadge show={isNewFeature} />
        </div>

        {/* More content */}
      </Stack>

      {/* Add tour component */}
      <ProductTour
        onComplete={() => {
          // Track completion
          console.log('User completed tour')
        }}
        onSkip={() => {
          // Track skip
          console.log('User skipped tour')
        }}
      />
    </Container>
  )
}
```

## Testing Checklist

- [ ] Tour starts automatically for new users
- [ ] All steps highlight correct elements
- [ ] Tooltips position correctly on all screen sizes
- [ ] Skip button works
- [ ] Back/Next navigation works
- [ ] Finish button completes tour
- [ ] FAB appears after completion
- [ ] FAB restarts tour correctly
- [ ] Dark mode looks good
- [ ] Mobile responsive (if applicable)
- [ ] Smooth animations
- [ ] No console errors

## Support

For issues or questions, check:
1. Console for error messages
2. Element inspector to verify selectors
3. localStorage to check tour state
4. CSS z-index conflicts

