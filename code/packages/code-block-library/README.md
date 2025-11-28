# @optimandoai/code-block-library

Enterprise-grade React component library with 25+ advanced UI components for building modern web applications.

## Features

- 🎨 **30+ Advanced Components** - Charts, Forms, Navigation, Modals, Tables, Layouts
- 🔧 **Full TypeScript Support** - Complete type definitions and interfaces
- 📱 **Responsive Design** - Mobile-first approach with breakpoint support
- ♿ **Accessibility** - ARIA labels, keyboard navigation, focus management
- 🎭 **Multiple Themes** - Default, dark, minimal, and custom variants
- ⚡ **Performance** - Virtual scrolling, lazy loading, optimized rendering
- 🎯 **Enterprise Ready** - Production-tested components for complex applications

## Installation

```bash
npm install @optimandoai/code-block-library
# or
yarn add @optimandoai/code-block-library
# or
pnpm add @optimandoai/code-block-library
```

## Quick Start

```tsx
import { Button, Card, DataTable } from '@optimandoai/code-block-library';

function App() {
  return (
    <Card title="My Dashboard">
      <DataTable 
        data={data} 
        columns={columns}
        sortable
        filterable
        selectable
      />
      <Button variant="primary">Save Changes</Button>
    </Card>
  );
}
```

## Component Packages

### Charts (`@optimandoai/code-block-library/charts`)
Interactive data visualization components with tooltips and animations.
- **LineChart** - Multi-series line charts with legends
- **BarChart** - Vertical/horizontal bar charts with grouping
- **PieChart** - Pie and donut charts with click handlers
- **AreaChart** - Stacked area charts with gradients

### Forms (`@optimandoai/code-block-library/forms`)
Advanced form handling with validation and wizards.
- **FormBuilder** - Dynamic form generation from schemas
- **MultiStepForm** - Wizard forms with progress tracking
- **FileUpload** - Drag-and-drop file handling with previews
- **DatePicker** - Calendar widget with multiple date formats

### Navigation (`@optimandoai/code-block-library/navigation`)
Comprehensive navigation patterns for multi-page applications.
- **Navbar** - Responsive navigation with dropdowns and mobile support
- **Breadcrumbs** - Collapsible breadcrumb navigation
- **Tabs** - Advanced tab system with drag-drop reordering
- **Pagination** - Full-featured pagination with page size controls
- **Sidebar** - Collapsible sidebar with nested navigation
- **MenuDropdown** - Context menus with submenus and shortcuts

### Modals (`@optimandoai/code-block-library/modals`)
Overlay components for dialogs and notifications.
- **Modal** - Enterprise modal dialogs with animations
- **Drawer** - Slide-out panels with resize handles
- **Tooltip** - Intelligent tooltips with positioning
- **Popover** - Rich content popovers with arrows
- **Notification** - Toast notification system with stacking

### Tables (`@optimandoai/code-block-library/tables`)
High-performance data table components.
- **DataTable** - Full-featured table with sorting, filtering, pagination
- **TreeTable** - Hierarchical data display with expand/collapse
- **VirtualTable** - Virtual scrolling for large datasets

### Layouts (`@optimandoai/code-block-library/layouts`)
Flexible layout systems for responsive designs.
- **GridLayout** - Drag-and-drop grid system with collision detection
- **ResponsiveGrid** - CSS Grid with breakpoint management
- **FlexLayout** - Flexbox wrapper with responsive properties
- **DashboardLayout** - Widget-based dashboard with persistence

## Legacy Template System

This library also includes a CSP-compliant template system for building GlassView apps from text templates.
