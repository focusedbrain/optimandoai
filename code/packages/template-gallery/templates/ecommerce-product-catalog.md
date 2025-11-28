# E-commerce Product Catalog Template

```yaml
GLASSVIEW_APP:
  name: "E-commerce Product Catalog"
  description: "Modern product catalog with filtering, search, and shopping cart functionality"
  category: "E-commerce"
  difficulty: "Intermediate"
  features:
    - "Product search and filtering"
    - "Category navigation"
    - "Shopping cart management"
    - "Product details and images"
    - "Price and inventory tracking"
    - "Wishlist functionality"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Product Catalog"
      theme:
        primaryColor: "#e67e22"
        secondaryColor: "#34495e"
        backgroundColor: "#f8f9fa"
        accentColor: "#27ae60"
      initialState:
        searchQuery: ""
        selectedCategory: "all"
        priceRange: { min: 0, max: 1000 }
        sortBy: "name"
        products: []
        cart: []
        wishlist: []
        currentProduct: null
        showCart: false
        categories: [
          "Electronics",
          "Clothing", 
          "Books",
          "Home & Garden",
          "Sports & Outdoors"
        ]
        
  layout:
    - component: "container"
      props:
        style:
          maxWidth: "1200px"
          margin: "0 auto"
          padding: "20px"
        children:
          # Header
          - component: "container"
            props:
              style:
                display: "flex"
                justifyContent: "space-between"
                alignItems: "center"
                marginBottom: "30px"
                padding: "20px"
                backgroundColor: "white"
                borderRadius: "8px"
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
              children:
                - component: "display"
                  props:
                    text: "🛍️ ShopMart"
                    style:
                      fontSize: "32px"
                      fontWeight: "bold"
                      color: "#e67e22"
                      
                - component: "container"
                  props:
                    style:
                      display: "flex"
                      gap: "20px"
                      alignItems: "center"
                    children:
                      - component: "button"
                        props:
                          text: "❤️ Wishlist ({{ wishlist.length }})"
                          onClick: "toggleWishlist"
                          style:
                            backgroundColor: "#e74c3c"
                            color: "white"
                            padding: "10px 15px"
                            border: "none"
                            borderRadius: "6px"
                            cursor: "pointer"
                            
                      - component: "button"
                        props:
                          text: "🛒 Cart ({{ cart.length }})"
                          onClick: "toggleCart"
                          style:
                            backgroundColor: "#27ae60"
                            color: "white"
                            padding: "10px 15px"
                            border: "none"
                            borderRadius: "6px"
                            cursor: "pointer"
                            
          # Search and Filters
          - component: "container"
            props:
              style:
                backgroundColor: "white"
                padding: "20px"
                borderRadius: "8px"
                marginBottom: "20px"
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
              children:
                - component: "container"
                  props:
                    style:
                      display: "flex"
                      gap: "15px"
                      marginBottom: "20px"
                      flexWrap: "wrap"
                    children:
                      - component: "input"
                        props:
                          placeholder: "Search products..."
                          value: "{{ searchQuery }}"
                          onChange: "updateSearch"
                          style:
                            flex: "1"
                            minWidth: "250px"
                            padding: "12px"
                            border: "1px solid #bdc3c7"
                            borderRadius: "6px"
                            fontSize: "16px"
                            
                      - component: "button"
                        props:
                          text: "🔍 Search"
                          onClick: "searchProducts"
                          style:
                            backgroundColor: "#3498db"
                            color: "white"
                            padding: "12px 20px"
                            border: "none"
                            borderRadius: "6px"
                            cursor: "pointer"
                            
                - component: "container"
                  props:
                    style:
                      display: "flex"
                      gap: "15px"
                      flexWrap: "wrap"
                    children:
                      - component: "select"
                        props:
                          value: "{{ selectedCategory }}"
                          onChange: "filterByCategory"
                          options: "{{ [{ value: 'all', label: 'All Categories' }, ...categories.map(cat => ({ value: cat.toLowerCase(), label: cat }))] }}"
                          style:
                            padding: "10px"
                            border: "1px solid #bdc3c7"
                            borderRadius: "6px"
                            
                      - component: "select"
                        props:
                          value: "{{ sortBy }}"
                          onChange: "changeSortBy"
                          options:
                            - { value: "name", label: "Sort by Name" }
                            - { value: "price-low", label: "Price: Low to High" }
                            - { value: "price-high", label: "Price: High to Low" }
                            - { value: "rating", label: "Customer Rating" }
                          style:
                            padding: "10px"
                            border: "1px solid #bdc3c7"
                            borderRadius: "6px"
                            
                      - component: "container"
                        props:
                          style:
                            display: "flex"
                            alignItems: "center"
                            gap: "10px"
                          children:
                            - component: "display"
                              props:
                                text: "Price Range:"
                                style:
                                  fontWeight: "bold"
                                  
                            - component: "input"
                              props:
                                type: "number"
                                placeholder: "Min"
                                value: "{{ priceRange.min }}"
                                onChange: "updateMinPrice"
                                style:
                                  width: "80px"
                                  padding: "8px"
                                  border: "1px solid #bdc3c7"
                                  borderRadius: "4px"
                                  
                            - component: "display"
                              props:
                                text: "-"
                                
                            - component: "input"
                              props:
                                type: "number"
                                placeholder: "Max"
                                value: "{{ priceRange.max }}"
                                onChange: "updateMaxPrice"
                                style:
                                  width: "80px"
                                  padding: "8px"
                                  border: "1px solid #bdc3c7"
                                  borderRadius: "4px"
                                  
          # Products Grid
          - component: "conditional"
            props:
              condition: "{{ products.length > 0 }}"
              component:
                component: "container"
                props:
                  style:
                    display: "grid"
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))"
                    gap: "20px"
                    marginBottom: "40px"
                  children:
                    - component: "list"
                      props:
                        items: "{{ products }}"
                        itemTemplate:
                          component: "container"
                          props:
                            style:
                              backgroundColor: "white"
                              border: "1px solid #ecf0f1"
                              borderRadius: "12px"
                              padding: "20px"
                              boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                              transition: "transform 0.2s"
                              cursor: "pointer"
                            onClick: "selectProduct"
                            children:
                              - component: "container"
                                props:
                                  style:
                                    width: "100%"
                                    height: "200px"
                                    backgroundColor: "#f8f9fa"
                                    borderRadius: "8px"
                                    marginBottom: "15px"
                                    display: "flex"
                                    alignItems: "center"
                                    justifyContent: "center"
                                  children:
                                    - component: "display"
                                      props:
                                        text: "{{ item.image || '🖼️' }}"
                                        style:
                                          fontSize: "60px"
                                          
                              - component: "display"
                                props:
                                  text: "{{ item.name }}"
                                  style:
                                    fontSize: "18px"
                                    fontWeight: "bold"
                                    marginBottom: "8px"
                                    color: "#2c3e50"
                                    
                              - component: "display"
                                props:
                                  text: "{{ item.description }}"
                                  style:
                                    color: "#7f8c8d"
                                    fontSize: "14px"
                                    marginBottom: "12px"
                                    lineHeight: "1.4"
                                    
                              - component: "container"
                                props:
                                  style:
                                    display: "flex"
                                    justifyContent: "space-between"
                                    alignItems: "center"
                                    marginBottom: "12px"
                                  children:
                                    - component: "display"
                                      props:
                                        text: "${{ item.price }}"
                                        style:
                                          fontSize: "24px"
                                          fontWeight: "bold"
                                          color: "#e67e22"
                                          
                                    - component: "display"
                                      props:
                                        text: "⭐ {{ item.rating }}"
                                        style:
                                          fontSize: "14px"
                                          color: "#f39c12"
                                          
                              - component: "container"
                                props:
                                  style:
                                    display: "flex"
                                    gap: "8px"
                                  children:
                                    - component: "button"
                                      props:
                                        text: "🛒 Add to Cart"
                                        onClick: "addToCart"
                                        style:
                                          flex: "1"
                                          backgroundColor: "#27ae60"
                                          color: "white"
                                          padding: "10px"
                                          border: "none"
                                          borderRadius: "6px"
                                          cursor: "pointer"
                                          fontSize: "14px"
                                          
                                    - component: "button"
                                      props:
                                        text: "❤️"
                                        onClick: "toggleWishlistItem"
                                        style:
                                          backgroundColor: "{{ wishlist.some(w => w.id === item.id) ? '#e74c3c' : '#ecf0f1' }}"
                                          color: "{{ wishlist.some(w => w.id === item.id) ? 'white' : '#7f8c8d' }}"
                                          padding: "10px"
                                          border: "none"
                                          borderRadius: "6px"
                                          cursor: "pointer"
                                          
          # No Products Found
          - component: "conditional"
            props:
              condition: "{{ products.length === 0 }}"
              component:
                component: "container"
                props:
                  style:
                    textAlign: "center"
                    padding: "60px"
                    backgroundColor: "white"
                    borderRadius: "8px"
                  children:
                    - component: "display"
                      props:
                        text: "🔍 No products found"
                        style:
                          fontSize: "24px"
                          color: "#7f8c8d"
                          marginBottom: "10px"
                          
                    - component: "display"
                      props:
                        text: "Try adjusting your search or filters"
                        style:
                          color: "#95a5a6"
                          
          # Shopping Cart Modal
          - component: "conditional"
            props:
              condition: "{{ showCart }}"
              component:
                component: "container"
                props:
                  style:
                    position: "fixed"
                    top: "0"
                    left: "0"
                    width: "100vw"
                    height: "100vh"
                    backgroundColor: "rgba(0,0,0,0.5)"
                    display: "flex"
                    alignItems: "center"
                    justifyContent: "center"
                    zIndex: "1000"
                  children:
                    - component: "container"
                      props:
                        style:
                          backgroundColor: "white"
                          borderRadius: "12px"
                          padding: "30px"
                          maxWidth: "600px"
                          maxHeight: "80vh"
                          overflow: "auto"
                          margin: "20px"
                        children:
                          - component: "container"
                            props:
                              style:
                                display: "flex"
                                justifyContent: "space-between"
                                alignItems: "center"
                                marginBottom: "20px"
                              children:
                                - component: "display"
                                  props:
                                    text: "🛒 Shopping Cart"
                                    style:
                                      fontSize: "24px"
                                      fontWeight: "bold"
                                      
                                - component: "button"
                                  props:
                                    text: "✕"
                                    onClick: "toggleCart"
                                    style:
                                      backgroundColor: "transparent"
                                      border: "none"
                                      fontSize: "24px"
                                      cursor: "pointer"
                                      
                          - component: "conditional"
                            props:
                              condition: "{{ cart.length > 0 }}"
                              component:
                                component: "container"
                                props:
                                  children:
                                    - component: "list"
                                      props:
                                        items: "{{ cart }}"
                                        itemTemplate:
                                          component: "container"
                                          props:
                                            style:
                                              display: "flex"
                                              justifyContent: "space-between"
                                              alignItems: "center"
                                              padding: "15px"
                                              border: "1px solid #ecf0f1"
                                              borderRadius: "6px"
                                              marginBottom: "10px"
                                            children:
                                              - component: "container"
                                                props:
                                                  children:
                                                    - component: "display"
                                                      props:
                                                        text: "{{ item.name }}"
                                                        style:
                                                          fontWeight: "bold"
                                                          marginBottom: "5px"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "${{ item.price }} x {{ item.quantity }}"
                                                        style:
                                                          color: "#7f8c8d"
                                                          
                                              - component: "button"
                                                props:
                                                  text: "Remove"
                                                  onClick: "removeFromCart"
                                                  style:
                                                    backgroundColor: "#e74c3c"
                                                    color: "white"
                                                    padding: "5px 10px"
                                                    border: "none"
                                                    borderRadius: "4px"
                                                    cursor: "pointer"
                                                    
                                    - component: "container"
                                      props:
                                        style:
                                          borderTop: "2px solid #ecf0f1"
                                          paddingTop: "20px"
                                          marginTop: "20px"
                                        children:
                                          - component: "display"
                                            props:
                                              text: "Total: ${{ cart.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2) }}"
                                              style:
                                                fontSize: "20px"
                                                fontWeight: "bold"
                                                textAlign: "center"
                                                marginBottom: "20px"
                                                
                                          - component: "button"
                                            props:
                                              text: "🔥 Checkout"
                                              onClick: "checkout"
                                              style:
                                                width: "100%"
                                                backgroundColor: "#e67e22"
                                                color: "white"
                                                padding: "15px"
                                                border: "none"
                                                borderRadius: "8px"
                                                fontSize: "18px"
                                                fontWeight: "bold"
                                                cursor: "pointer"
                                                
                          - component: "conditional"
                            props:
                              condition: "{{ cart.length === 0 }}"
                              component:
                                component: "display"
                                props:
                                  text: "Your cart is empty"
                                  style:
                                    textAlign: "center"
                                    color: "#7f8c8d"
                                    padding: "40px"

  actions:
    updateSearch:
      type: "setState"
      path: "searchQuery"
      value: "{{ value }}"
      
    filterByCategory:
      type: "setState"
      path: "selectedCategory"
      value: "{{ value }}"
      
    changeSortBy:
      type: "setState"
      path: "sortBy"
      value: "{{ value }}"
      
    updateMinPrice:
      type: "setState"
      path: "priceRange.min"
      value: "{{ parseInt(value) || 0 }}"
      
    updateMaxPrice:
      type: "setState"
      path: "priceRange.max"
      value: "{{ parseInt(value) || 1000 }}"
      
    searchProducts:
      type: "setState"
      path: "products"
      value: "{{ [
        { id: 1, name: 'Wireless Headphones', description: 'High-quality noise-canceling headphones', price: 199.99, rating: 4.5, category: 'electronics', image: '🎧' },
        { id: 2, name: 'Cotton T-Shirt', description: 'Comfortable 100% cotton t-shirt', price: 29.99, rating: 4.2, category: 'clothing', image: '👕' },
        { id: 3, name: 'JavaScript Guide', description: 'Complete guide to modern JavaScript', price: 39.99, rating: 4.8, category: 'books', image: '📚' },
        { id: 4, name: 'Garden Tools Set', description: 'Complete gardening tools for your garden', price: 89.99, rating: 4.3, category: 'home-garden', image: '🌱' },
        { id: 5, name: 'Running Shoes', description: 'Professional running shoes for athletes', price: 129.99, rating: 4.6, category: 'sports', image: '👟' },
        { id: 6, name: 'Smartphone', description: 'Latest smartphone with advanced features', price: 699.99, rating: 4.7, category: 'electronics', image: '📱' },
        { id: 7, name: 'Winter Jacket', description: 'Warm winter jacket for cold weather', price: 159.99, rating: 4.4, category: 'clothing', image: '🧥' },
        { id: 8, name: 'Cookbook Collection', description: 'Collection of international recipes', price: 49.99, rating: 4.5, category: 'books', image: '📖' }
      ] }}"
      
    selectProduct:
      type: "setState"
      path: "currentProduct"
      value: "{{ item }}"
      
    addToCart:
      type: "setState"
      path: "cart"
      value: "{{ [...cart.filter(c => c.id !== item.id), { ...item, quantity: (cart.find(c => c.id === item.id)?.quantity || 0) + 1 }] }}"
      
    removeFromCart:
      type: "setState"
      path: "cart"
      value: "{{ cart.filter(c => c.id !== item.id) }}"
      
    toggleWishlistItem:
      type: "setState"
      path: "wishlist"
      value: "{{ wishlist.some(w => w.id === item.id) ? wishlist.filter(w => w.id !== item.id) : [...wishlist, item] }}"
      
    toggleCart:
      type: "setState"
      path: "showCart"
      value: "{{ !showCart }}"
      
    toggleWishlist:
      type: "setState"
      path: "showWishlist"
      value: "{{ !showWishlist }}"
      
    checkout:
      type: "setState"
      path: "cart"
      value: "[]"
      then:
        - type: "setState"
          path: "showCart"
          value: false
```