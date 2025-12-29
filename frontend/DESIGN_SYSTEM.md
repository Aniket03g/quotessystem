# Grove Systems CRM - Modern Design System

This document outlines the design system for the modernized Astro dashboard UI using Tailwind CSS.

## 🎨 Design Principles

1. **Modern & Clean**: Soft shadows, rounded corners, ample white space
2. **Consistent**: Unified color palette, typography, and spacing
3. **Accessible**: High contrast, clear hierarchy, readable fonts
4. **Responsive**: Mobile-first approach with collapsible sidebar

---

## 🎯 Layout Structure

### DashboardLayout Component
Location: `src/layouts/DashboardLayout.astro`

**Structure:**
```
┌─────────────────────────────────────────┐
│  Sidebar (Desktop)    │   Main Content  │
│  - Logo & Brand       │   - Top Header  │
│  - Navigation Menu    │   - Page Content│
│  - User Profile       │                 │
└─────────────────────────────────────────┘
```

**Key Features:**
- Fixed sidebar on desktop (264px width)
- Collapsible mobile sidebar with overlay
- Top header with search and notifications
- Smooth transitions and animations

---

## 🎨 Color Palette

### Primary Colors
```css
primary-50:  #eff6ff  /* Light backgrounds */
primary-100: #dbeafe  /* Hover states */
primary-500: #3b82f6  /* Primary actions */
primary-600: #2563eb  /* Primary buttons */
primary-700: #1d4ed8  /* Active states */
```

### Neutral Colors (Slate)
```css
slate-50:  #f8fafc  /* Page background */
slate-100: #f1f5f9  /* Sidebar background */
slate-200: #e2e8f0  /* Borders */
slate-400: #94a3b8  /* Muted text, icons */
slate-500: #64748b  /* Secondary text */
slate-600: #475569  /* Body text */
slate-800: #1e293b  /* Headings */
slate-900: #0f172a  /* Primary text */
```

### Semantic Colors
```css
/* Success */
emerald-50:  #ecfdf5
emerald-200: #a7f3d0
emerald-600: #059669

/* Error */
red-50:  #fef2f2
red-200: #fecaca
red-600: #dc2626
red-800: #991b1b

/* Warning */
amber-50:  #fffbeb
amber-200: #fde68a
amber-600: #d97706
```

---

## 📝 Typography

### Font Family
```css
font-sans: 'Inter', 'Roboto', system-ui, sans-serif
```

### Text Styles

**Page Titles:**
```html
<h1 class="text-2xl font-semibold text-slate-800">Page Title</h1>
```

**Section Headings:**
```html
<h2 class="text-lg font-semibold text-slate-800">Section Title</h2>
```

**Subtitles:**
```html
<p class="text-sm text-slate-600 mt-1">Subtitle or description</p>
```

**Body Text:**
```html
<p class="text-sm text-slate-600">Regular body text</p>
```

**Labels (Form/Table):**
```html
<span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Label</span>
```

**Muted/N/A Text:**
```html
<span class="text-slate-400 italic">N/A</span>
```

---

## 🔘 Buttons

### Primary Button
```html
<button class="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
  <svg class="w-5 h-5"><!-- icon --></svg>
  Button Text
</button>
```

### Secondary Button
```html
<button class="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
  Button Text
</button>
```

### Icon Button
```html
<button class="p-2 rounded-lg hover:bg-slate-100 transition-colors">
  <svg class="w-6 h-6 text-slate-600"><!-- icon --></svg>
</button>
```

---

## 📊 Tables

### Modern Table Structure
```html
<div class="bg-white rounded-2xl shadow-sm border border-slate-200">
  <table class="w-full">
    <thead class="bg-slate-50 border-b border-slate-200">
      <tr>
        <th class="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
          Column Name
        </th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-200">
      <!-- Zebra striping with hover -->
      <tr class="cursor-pointer transition-colors hover:bg-slate-50 odd:bg-white even:bg-slate-50/50">
        <td class="px-6 py-4 text-sm text-slate-600">Cell content</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Table Features
- **Zebra Striping**: `odd:bg-white even:bg-slate-50/50`
- **Hover Effect**: `hover:bg-slate-50`
- **Selected Row**: `bg-blue-50 hover:bg-blue-100`
- **Padding**: `px-6 py-4` for cells, `px-6 py-3` for headers
- **Text Sizes**: `text-xs` for headers, `text-sm` for cells

---

## 🃏 Cards

### Standard Card
```html
<div class="bg-white rounded-2xl shadow-sm border border-slate-200">
  <div class="p-6">
    <!-- Card content -->
  </div>
</div>
```

### Card with Header
```html
<div class="bg-white rounded-2xl shadow-sm border border-slate-200">
  <div class="px-6 py-4 border-b border-slate-200">
    <h3 class="text-sm font-semibold text-slate-800">Card Title</h3>
  </div>
  <div class="p-6">
    <!-- Card content -->
  </div>
</div>
```

### Selected/Highlighted Card
```html
<div class="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl overflow-hidden shadow-sm">
  <div class="flex items-center justify-between px-6 py-4 border-b border-emerald-200 bg-white/50">
    <!-- Header with checkmark icon -->
  </div>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
    <!-- Grid content -->
  </div>
</div>
```

---

## 🔍 Search & Filters

### Search Input
```html
<div class="relative">
  <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400">
    <!-- Search icon -->
  </svg>
  <input 
    type="text" 
    placeholder="Search..." 
    class="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
  />
  <!-- Optional: Spinner on right -->
  <div class="absolute right-3 top-1/2 -translate-y-1/2">
    <svg class="animate-spin w-5 h-5 text-blue-600"><!-- spinner --></svg>
  </div>
</div>
```

### Search Status
```html
<div class="mt-2 text-xs text-slate-500">
  Found 15 results matching "search term"
</div>
```

---

## 📱 States

### Loading State
```html
<div class="py-12 text-center">
  <svg class="animate-spin w-8 h-8 text-blue-600 mx-auto mb-3">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
  <p class="text-sm text-slate-600">Loading...</p>
</div>
```

### Error State
```html
<div class="p-4 bg-red-50 border border-red-200 rounded-lg">
  <div class="flex items-start gap-3">
    <svg class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5">
      <!-- Alert icon -->
    </svg>
    <p class="text-sm text-red-800">Error message here</p>
  </div>
</div>
```

### Empty State
```html
<div class="py-12 text-center">
  <svg class="w-16 h-16 text-slate-300 mx-auto mb-4">
    <!-- Empty state icon -->
  </svg>
  <p class="text-slate-600 font-medium mb-1">No items found</p>
  <p class="text-sm text-slate-500">Try adjusting your search or filters</p>
</div>
```

---

## 🎭 Icons

Use **Heroicons** (outline style) for consistency:
- Size: `w-5 h-5` for buttons/inline, `w-6 h-6` for headers
- Color: `text-slate-400` for muted, `text-slate-600` for active
- Stroke width: `stroke-width="2"`

**Common Icons:**
- Search: `M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z`
- Plus: `M12 4v16m8-8H4`
- Check: `M5 13l4 4L19 7`
- Alert: `M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z`

---

## 📐 Spacing & Layout

### Container Padding
```css
p-6    /* Standard card/section padding */
px-6   /* Horizontal padding for headers */
py-4   /* Vertical padding for compact sections */
```

### Gaps
```css
gap-2  /* Small gaps (icons + text) */
gap-3  /* Medium gaps (form elements) */
gap-4  /* Large gaps (cards, sections) */
gap-6  /* Extra large gaps (page sections) */
```

### Margins
```css
mb-6   /* Bottom margin for page sections */
mt-1   /* Small top margin for subtitles */
mt-2   /* Medium top margin for status text */
```

---

## 🎬 Animations & Transitions

### Standard Transitions
```css
transition-colors   /* For hover effects on buttons/links */
transition-all      /* For complex state changes */
```

### Hover Effects
```css
hover:bg-slate-50      /* Subtle background change */
hover:bg-blue-700      /* Button hover */
hover:text-slate-900   /* Text color change */
```

### Loading Spinner
```html
<svg class="animate-spin w-5 h-5 text-blue-600">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
</svg>
```

---

## 📱 Responsive Design

### Breakpoints
```css
sm:  640px   /* Small tablets */
md:  768px   /* Tablets */
lg:  1024px  /* Desktops (sidebar appears) */
xl:  1280px  /* Large desktops */
```

### Mobile-First Approach
```html
<!-- Stack on mobile, row on desktop -->
<div class="flex flex-col sm:flex-row gap-4">

<!-- Hide on mobile, show on desktop -->
<div class="hidden lg:flex">

<!-- Full width on mobile, constrained on desktop -->
<div class="w-full lg:w-64">
```

---

## 🔄 How to Apply to Other Pages

### Step 1: Update Layout Import
```astro
---
import DashboardLayout from '../layouts/DashboardLayout.astro';
---

<DashboardLayout title="Page Title" currentPage="page-name">
  <!-- Content -->
</DashboardLayout>
```

### Step 2: Page Header Pattern
```html
<div class="mb-6">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold text-slate-800">Page Title</h1>
      <p class="text-sm text-slate-600 mt-1">Page description</p>
    </div>
    <button class="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
      <svg class="w-5 h-5"><!-- icon --></svg>
      Action Button
    </button>
  </div>
</div>
```

### Step 3: Content Card Pattern
```html
<div class="bg-white rounded-2xl shadow-sm border border-slate-200">
  <!-- Search/Filter Section -->
  <div class="p-6 border-b border-slate-200">
    <!-- Search input -->
  </div>

  <!-- Table/Content -->
  <div class="overflow-x-auto">
    <table class="w-full">
      <!-- Table content -->
    </table>
  </div>
</div>
```

### Step 4: Replace Inline Styles
- Remove all `style="display: none"` → Use `class="hidden"`
- Remove all `style="display: block"` → Use `classList.remove('hidden')`
- Remove custom CSS → Use Tailwind utility classes

### Step 5: Update JavaScript Display Logic
```javascript
// Old way
element.style.display = 'none';
element.style.display = 'block';

// New way (Tailwind)
element.classList.add('hidden');
element.classList.remove('hidden');
```

---

## 📋 Quick Reference Checklist

When modernizing a page, ensure:

- [ ] Import `DashboardLayout` instead of `Layout`
- [ ] Add page header with title and action button
- [ ] Wrap content in white card with `rounded-2xl shadow-sm`
- [ ] Use Tailwind classes for all styling (no custom CSS)
- [ ] Replace "N/A" with `<span class="text-slate-400 italic">N/A</span>`
- [ ] Add zebra striping to tables: `odd:bg-white even:bg-slate-50/50`
- [ ] Add hover effects: `hover:bg-slate-50`
- [ ] Use proper spacing: `px-6 py-4` for table cells
- [ ] Update display logic to use `hidden` class
- [ ] Add loading/error/empty states with proper styling
- [ ] Ensure mobile responsiveness with `sm:`, `lg:` prefixes
- [ ] Use Heroicons for all icons
- [ ] Add smooth transitions: `transition-colors`

---

## 🎨 Example Pages

### Modernized Pages
- ✅ **Accounts** (`src/pages/accounts.astro`) - Fully modernized with Tailwind

### Pages to Modernize
- ⏳ **Products** (`src/pages/products.astro`)
- ⏳ **Quotes** (`src/pages/quotes.astro`)
- ⏳ **Contacts** (create new)
- ⏳ **Import History** (create new)
- ⏳ **Company Profile** (create new)

Follow the same pattern as `accounts.astro` for consistency!

---

## 🚀 Getting Started

1. **Install Dependencies** (already done):
   ```bash
   npm install -D tailwindcss @astrojs/tailwind
   ```

2. **Start Dev Server**:
   ```bash
   npm run dev
   ```

3. **View Modernized UI**:
   - Navigate to `http://localhost:4321/accounts`
   - Login with demo credentials
   - Experience the modern dashboard!

---

## 📞 Support

For questions or issues with the design system, refer to:
- Tailwind CSS Documentation: https://tailwindcss.com/docs
- Heroicons: https://heroicons.com
- Astro Documentation: https://docs.astro.build

---

**Last Updated**: December 13, 2025
**Version**: 1.0.0
