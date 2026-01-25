# 3D Config Tool - React/TypeScript Conversion

This tool has been converted from a standalone HTML file (`spline-tool-v1.html`) to a React/TypeScript component structure for integration into the Elevia Design app.

## Tool Overview

Advanced 3D object configuration tool with scroll-based keyframe animations for Spline 3D scenes.

### Features
- **Spline Scene Integration**: Load and interact with 3D scenes from Spline
- **Keyframe Animation System**: Create scroll-based animations with position and rotation controls
- **Responsive Breakpoints**: Configure animations for 5 breakpoints (Monitor, Desktop, Laptop, Tablet, Mobile)
- **Live Preview**: Real-time interpolation between keyframes as you scroll
- **Relative Positioning**: 0,0,0 values keep objects centered at their original scene position
- **Ascending Position Validation**: Prevents adding keyframes out of order
- **Export Options**: Download configuration as JSON or CSS (per breakpoint)
- **Custom Backgrounds**: Set color or upload images for preview

## File Structure

```
src/components/3d-config/
├── README.md                    # This file
├── types.ts                     # TypeScript interfaces and types
├── SplineConfigTool.css         # Complete CSS (extracted from HTML)
├── SplineConfigTool.tsx         # Main React component
├── index.ts                     # Export barrel
└── hooks/
    ├── useSplineScene.ts        # Spline scene management
    ├── useKeyframeAnimation.ts  # Keyframe animation logic
    └── useScrollPosition.ts     # Scroll position tracking

src/pages/3d-config/
└── index.tsx                    # Page wrapper component
```

## Dependencies

```json
{
  "@splinetool/runtime": "^latest"
}
```

## Tool Config for `tools.ts`

Include this configuration in your commit message:

```typescript
{
  id: '3d-config',
  name: '3D Config Tool',
  description: 'Advanced 3D object configuration tool with scroll-based animations. Configure Spline 3D objects with keyframe animations, responsive breakpoints, and export to JSON/CSS.',
  icon: '🎨',
  category: 'design',
  path: '/3d-config',
  component: '3d-config',
  tags: ['3d', 'animation', 'spline', 'responsive', 'keyframes', 'scroll'],
  featured: true
}
```

## Implementation Status

### ✅ Completed
- Type definitions
- CSS extraction and conversion
- Basic component structure
- Documentation

### 🚧 In Progress  
- Full React component conversion (due to large file size ~3000 lines)
- Custom hooks for state management
- Spline integration utilities

### 📋 Next Steps

1. **Complete Component Conversion**: The HTML file is very large. Conversion approach:
   - Extract all JavaScript logic from `<script>` tags
   - Convert global functions to React hooks and component methods
   - Replace DOM queries with React refs
   - Convert inline event handlers to React event handlers

2. **Test Integration**: Ensure the tool works within the main app

3. **Optimize Performance**: Memoize expensive calculations, optimize renders

## Usage Example

```typescript
import { SplineConfigTool } from '@/components/3d-config';

export default function Config3DPage() {
  return <SplineConfigTool />;
}
```

## Original HTML File

The original implementation is in `/spline-tool-v1.html` (~3158 lines).

This is a production-ready tool with:
- Obsidian Studio dark theme
- Complete UI/UX implementation
- All features fully functional
- Extensively tested

## Conversion Notes

Due to the large size of the original file, a complete automated conversion would require:

1. Splitting into multiple smaller components
2. Creating custom hooks for:
   - Spline scene management
   - Keyframe animation system
   - Config state management
   - Modal management
   - File handling
3. Converting all window functions to React patterns
4. Replacing document queries with refs/state

The tool is ready for manual completion or can be used as standalone HTML until full React conversion is complete.

