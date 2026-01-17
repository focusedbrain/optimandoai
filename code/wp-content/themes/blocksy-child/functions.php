<?php
/**
 * Blocksy Child Theme Functions
 * Fix container background colors from grey to light green
 */

// Enqueue parent and child theme styles
function blocksy_child_enqueue_styles() {
    // Enqueue parent theme style
    wp_enqueue_style('blocksy-parent-style', get_template_directory_uri() . '/style.css');
    
    // Enqueue child theme style with higher priority
    wp_enqueue_style('blocksy-child-style', 
        get_stylesheet_directory_uri() . '/style.css',
        array('blocksy-parent-style'),
        wp_get_theme()->get('Version')
    );
}
add_action('wp_enqueue_scripts', 'blocksy_child_enqueue_styles', 15);

// Add custom CSS to override container backgrounds
function blocksy_child_container_background_fix() {
    ?>
    <style type="text/css">
        /* Override all container backgrounds from grey to light green */
        .container,
        [class*="container"],
        .ct-container,
        .ct-container-narrow,
        .ct-container-wide,
        .entry-content,
        .site-content,
        .content-area,
        .main-content,
        article,
        .post,
        .page,
        .widget,
        .sidebar .widget,
        .footer-widgets .widget,
        section,
        .section {
            background-color: #e8f5e9 !important; /* Light green */
        }
        
        /* Ensure nested containers also get the light green background */
        .container .container,
        .ct-container .ct-container,
        [class*="container"] [class*="container"] {
            background-color: #c8e6c9 !important; /* Slightly darker green for nested */
        }
        
        /* Override any grey backgrounds specifically */
        [style*="background-color: #f5f5f5"],
        [style*="background-color: #fafafa"],
        [style*="background-color: #e5e5e5"],
        [style*="background-color: #cccccc"],
        [style*="background: #f5f5f5"],
        [style*="background: #fafafa"],
        [style*="background: #e5e5e5"],
        [style*="background: #cccccc"] {
            background-color: #e8f5e9 !important;
        }
    </style>
    <?php
}
add_action('wp_head', 'blocksy_child_container_background_fix', 999);
