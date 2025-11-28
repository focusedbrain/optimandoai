# Real Estate Portfolio Template

```yaml
GLASSVIEW_APP:
  name: "Real Estate Portfolio"
  description: "Professional real estate showcase with property listings, search, and contact features"
  category: "Business"
  difficulty: "Intermediate"
  features:
    - "Property listings with photos and details"
    - "Advanced search and filtering"
    - "Property comparison tool"
    - "Agent contact forms"
    - "Interactive property cards"
    - "Mortgage calculator"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Elite Properties"
      theme:
        primaryColor: "#2c5aa0"
        secondaryColor: "#1e3a5f"
        backgroundColor: "#f8fafc"
        accentColor: "#3b82f6"
      initialState:
        currentView: "listings"
        properties: []
        selectedProperty: null
        searchFilters:
          priceMin: ""
          priceMax: ""
          bedrooms: ""
          bathrooms: ""
          propertyType: ""
          location: ""
        comparisonList: []
        isComparing: false
        mortgageCalculator:
          price: ""
          downPayment: ""
          interestRate: "3.5"
          loanTerm: "30"
          monthlyPayment: 0
        
  layout:
    - component: "container"
      props:
        style:
          fontFamily: "Arial, sans-serif"
          backgroundColor: "#f8fafc"
          minHeight: "100vh"
        children:
          # Header
          - component: "container"
            props:
              style:
                backgroundColor: "white"
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                padding: "15px 0"
                position: "sticky"
                top: "0"
                zIndex: "1000"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1400px"
                      margin: "0 auto"
                      padding: "0 20px"
                      display: "flex"
                      justifyContent: "space-between"
                      alignItems: "center"
                    children:
                      # Logo
                      - component: "display"
                        props:
                          text: "🏡 Elite Properties"
                          style:
                            fontSize: "32px"
                            fontWeight: "bold"
                            color: "#2c5aa0"
                            
                      # Navigation
                      - component: "container"
                        props:
                          style:
                            display: "flex"
                            gap: "25px"
                            alignItems: "center"
                          children:
                            - component: "button"
                              props:
                                text: "🏠 Listings"
                                onClick: "showListings"
                                style:
                                  backgroundColor: "{{ currentView === 'listings' ? '#3b82f6' : 'transparent' }}"
                                  color: "{{ currentView === 'listings' ? 'white' : '#2c5aa0' }}"
                                  padding: "12px 20px"
                                  border: "2px solid #3b82f6"
                                  borderRadius: "8px"
                                  cursor: "pointer"
                                  fontWeight: "600"
                                  fontSize: "16px"
                                  
                            - component: "button"
                              props:
                                text: "🧮 Calculator"
                                onClick: "showCalculator"
                                style:
                                  backgroundColor: "{{ currentView === 'calculator' ? '#3b82f6' : 'transparent' }}"
                                  color: "{{ currentView === 'calculator' ? 'white' : '#2c5aa0' }}"
                                  padding: "12px 20px"
                                  border: "2px solid #3b82f6"
                                  borderRadius: "8px"
                                  cursor: "pointer"
                                  fontWeight: "600"
                                  fontSize: "16px"
                                  
                            - component: "conditional"
                              props:
                                condition: "{{ comparisonList.length > 0 }}"
                                component:
                                  component: "button"
                                  props:
                                    text: "📊 Compare ({{ comparisonList.length }})"
                                    onClick: "showComparison"
                                    style:
                                      backgroundColor: "#10b981"
                                      color: "white"
                                      padding: "12px 20px"
                                      border: "none"
                                      borderRadius: "8px"
                                      cursor: "pointer"
                                      fontWeight: "600"
                                      fontSize: "16px"
                                      
          # Property Listings View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'listings' }}"
              component:
                component: "container"
                props:
                  style:
                    maxWidth: "1400px"
                    margin: "0 auto"
                    padding: "30px 20px"
                  children:
                    # Search Filters
                    - component: "container"
                      props:
                        style:
                          backgroundColor: "white"
                          padding: "30px"
                          borderRadius: "12px"
                          boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                          marginBottom: "30px"
                        children:
                          - component: "display"
                            props:
                              text: "🔍 Find Your Perfect Property"
                              style:
                                fontSize: "24px"
                                fontWeight: "bold"
                                marginBottom: "20px"
                                color: "#2c5aa0"
                                
                          - component: "container"
                            props:
                              style:
                                display: "grid"
                                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))"
                                gap: "15px"
                                marginBottom: "20px"
                              children:
                                # Location Filter
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Location"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "select"
                                        props:
                                          value: "{{ searchFilters.location }}"
                                          onChange: "updateLocationFilter"
                                          options:
                                            - { value: "", label: "All Locations" }
                                            - { value: "manhattan", label: "Manhattan" }
                                            - { value: "brooklyn", label: "Brooklyn" }
                                            - { value: "queens", label: "Queens" }
                                            - { value: "bronx", label: "Bronx" }
                                            - { value: "staten-island", label: "Staten Island" }
                                          style:
                                            width: "100%"
                                            padding: "12px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "6px"
                                            fontSize: "14px"
                                            
                                # Property Type Filter
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Property Type"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "select"
                                        props:
                                          value: "{{ searchFilters.propertyType }}"
                                          onChange: "updatePropertyTypeFilter"
                                          options:
                                            - { value: "", label: "All Types" }
                                            - { value: "apartment", label: "Apartment" }
                                            - { value: "house", label: "House" }
                                            - { value: "condo", label: "Condo" }
                                            - { value: "townhouse", label: "Townhouse" }
                                            - { value: "loft", label: "Loft" }
                                          style:
                                            width: "100%"
                                            padding: "12px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "6px"
                                            fontSize: "14px"
                                            
                                # Bedrooms Filter
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Bedrooms"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "select"
                                        props:
                                          value: "{{ searchFilters.bedrooms }}"
                                          onChange: "updateBedroomsFilter"
                                          options:
                                            - { value: "", label: "Any" }
                                            - { value: "1", label: "1+" }
                                            - { value: "2", label: "2+" }
                                            - { value: "3", label: "3+" }
                                            - { value: "4", label: "4+" }
                                          style:
                                            width: "100%"
                                            padding: "12px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "6px"
                                            fontSize: "14px"
                                            
                                # Bathrooms Filter
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Bathrooms"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "select"
                                        props:
                                          value: "{{ searchFilters.bathrooms }}"
                                          onChange: "updateBathroomsFilter"
                                          options:
                                            - { value: "", label: "Any" }
                                            - { value: "1", label: "1+" }
                                            - { value: "2", label: "2+" }
                                            - { value: "3", label: "3+" }
                                          style:
                                            width: "100%"
                                            padding: "12px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "6px"
                                            fontSize: "14px"
                                            
                                # Price Min
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Min Price"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "input"
                                        props:
                                          placeholder: "$500,000"
                                          value: "{{ searchFilters.priceMin }}"
                                          onChange: "updatePriceMinFilter"
                                          style:
                                            width: "100%"
                                            padding: "12px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "6px"
                                            fontSize: "14px"
                                            
                                # Price Max
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Max Price"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "input"
                                        props:
                                          placeholder: "$2,000,000"
                                          value: "{{ searchFilters.priceMax }}"
                                          onChange: "updatePriceMaxFilter"
                                          style:
                                            width: "100%"
                                            padding: "12px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "6px"
                                            fontSize: "14px"
                                            
                          - component: "container"
                            props:
                              style:
                                display: "flex"
                                gap: "15px"
                                justifyContent: "flex-end"
                              children:
                                - component: "button"
                                  props:
                                    text: "🔍 Search Properties"
                                    onClick: "searchProperties"
                                    style:
                                      backgroundColor: "#3b82f6"
                                      color: "white"
                                      padding: "12px 24px"
                                      border: "none"
                                      borderRadius: "6px"
                                      cursor: "pointer"
                                      fontWeight: "600"
                                      
                                - component: "button"
                                  props:
                                    text: "🗑️ Clear"
                                    onClick: "clearFilters"
                                    style:
                                      backgroundColor: "transparent"
                                      color: "#6b7280"
                                      padding: "12px 24px"
                                      border: "1px solid #d1d5db"
                                      borderRadius: "6px"
                                      cursor: "pointer"
                                      
                    # Property Grid
                    - component: "conditional"
                      props:
                        condition: "{{ properties.length > 0 }}"
                        component:
                          component: "container"
                          props:
                            style:
                              display: "grid"
                              gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))"
                              gap: "30px"
                            children:
                              - component: "list"
                                props:
                                  items: "{{ properties }}"
                                  itemTemplate:
                                    component: "container"
                                    props:
                                      style:
                                        backgroundColor: "white"
                                        borderRadius: "12px"
                                        overflow: "hidden"
                                        boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                        transition: "transform 0.2s"
                                        cursor: "pointer"
                                      onClick: "viewProperty"
                                      children:
                                        # Property Image
                                        - component: "container"
                                          props:
                                            style:
                                              height: "250px"
                                              backgroundColor: "#e5e7eb"
                                              background: "{{ 'url(' + item.image + ')' }}"
                                              backgroundSize: "cover"
                                              backgroundPosition: "center"
                                              position: "relative"
                                            children:
                                              # Price Badge
                                              - component: "container"
                                                props:
                                                  style:
                                                    position: "absolute"
                                                    top: "15px"
                                                    left: "15px"
                                                    backgroundColor: "#2c5aa0"
                                                    color: "white"
                                                    padding: "8px 15px"
                                                    borderRadius: "20px"
                                                    fontWeight: "bold"
                                                    fontSize: "18px"
                                                  children:
                                                    - component: "display"
                                                      props:
                                                        text: "${{ item.price.toLocaleString() }}"
                                                        
                                              # Compare Button
                                              - component: "button"
                                                props:
                                                  text: "{{ comparisonList.some(p => p.id === item.id) ? '✅' : '📊' }}"
                                                  onClick: "toggleComparison"
                                                  style:
                                                    position: "absolute"
                                                    top: "15px"
                                                    right: "15px"
                                                    backgroundColor: "white"
                                                    border: "none"
                                                    borderRadius: "50%"
                                                    width: "40px"
                                                    height: "40px"
                                                    cursor: "pointer"
                                                    fontSize: "16px"
                                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                                    
                                        # Property Details
                                        - component: "container"
                                          props:
                                            style:
                                              padding: "25px"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "{{ item.title }}"
                                                  style:
                                                    fontSize: "20px"
                                                    fontWeight: "bold"
                                                    marginBottom: "8px"
                                                    color: "#1f2937"
                                                    
                                              - component: "display"
                                                props:
                                                  text: "📍 {{ item.address }}"
                                                  style:
                                                    color: "#6b7280"
                                                    marginBottom: "15px"
                                                    fontSize: "14px"
                                                    
                                              - component: "container"
                                                props:
                                                  style:
                                                    display: "flex"
                                                    gap: "20px"
                                                    marginBottom: "15px"
                                                  children:
                                                    - component: "display"
                                                      props:
                                                        text: "🛏️ {{ item.bedrooms }} beds"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#374151"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "🚿 {{ item.bathrooms }} baths"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#374151"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "📐 {{ item.sqft.toLocaleString() }} sqft"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#374151"
                                                          
                                              - component: "display"
                                                props:
                                                  text: "{{ item.description }}"
                                                  style:
                                                    fontSize: "14px"
                                                    lineHeight: "1.5"
                                                    color: "#6b7280"
                                                    marginBottom: "20px"
                                                    
                                              - component: "container"
                                                props:
                                                  style:
                                                    display: "flex"
                                                    justifyContent: "space-between"
                                                    alignItems: "center"
                                                  children:
                                                    - component: "display"
                                                      props:
                                                        text: "{{ item.propertyType }}"
                                                        style:
                                                          padding: "4px 12px"
                                                          backgroundColor: "#e0e7ff"
                                                          color: "#3730a3"
                                                          borderRadius: "15px"
                                                          fontSize: "12px"
                                                          fontWeight: "600"
                                                          
                                                    - component: "button"
                                                      props:
                                                        text: "📧 Contact Agent"
                                                        onClick: "contactAgent"
                                                        style:
                                                          backgroundColor: "#10b981"
                                                          color: "white"
                                                          padding: "8px 16px"
                                                          border: "none"
                                                          borderRadius: "6px"
                                                          fontSize: "12px"
                                                          cursor: "pointer"
                                                          fontWeight: "600"
                                                          
                    # No Properties Found
                    - component: "conditional"
                      props:
                        condition: "{{ properties.length === 0 }}"
                        component:
                          component: "container"
                          props:
                            style:
                              backgroundColor: "white"
                              padding: "80px"
                              borderRadius: "12px"
                              textAlign: "center"
                            children:
                              - component: "display"
                                props:
                                  text: "🏠 Loading Properties..."
                                  style:
                                    fontSize: "24px"
                                    color: "#6b7280"
                                    marginBottom: "15px"
                                    
                              - component: "display"
                                props:
                                  text: "Please wait while we load the latest property listings."
                                  style:
                                    color: "#9ca3af"
                                    
                              - component: "button"
                                props:
                                  text: "🔄 Load Sample Properties"
                                  onClick: "loadSampleProperties"
                                  style:
                                    backgroundColor: "#3b82f6"
                                    color: "white"
                                    padding: "12px 24px"
                                    border: "none"
                                    borderRadius: "6px"
                                    cursor: "pointer"
                                    fontWeight: "600"
                                    marginTop: "20px"
                                    
          # Mortgage Calculator View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'calculator' }}"
              component:
                component: "container"
                props:
                  style:
                    maxWidth: "800px"
                    margin: "0 auto"
                    padding: "30px 20px"
                  children:
                    - component: "container"
                      props:
                        style:
                          backgroundColor: "white"
                          padding: "40px"
                          borderRadius: "12px"
                          boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                        children:
                          - component: "display"
                            props:
                              text: "🧮 Mortgage Calculator"
                              style:
                                fontSize: "32px"
                                fontWeight: "bold"
                                marginBottom: "10px"
                                color: "#2c5aa0"
                                textAlign: "center"
                                
                          - component: "display"
                            props:
                              text: "Calculate your monthly mortgage payment"
                              style:
                                fontSize: "16px"
                                color: "#6b7280"
                                textAlign: "center"
                                marginBottom: "40px"
                                
                          - component: "container"
                            props:
                              style:
                                display: "grid"
                                gridTemplateColumns: "1fr 1fr"
                                gap: "25px"
                                marginBottom: "30px"
                              children:
                                # Home Price
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Home Price *"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "input"
                                        props:
                                          placeholder: "$850,000"
                                          value: "{{ mortgageCalculator.price }}"
                                          onChange: "updateMortgagePrice"
                                          style:
                                            width: "100%"
                                            padding: "15px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "8px"
                                            fontSize: "16px"
                                            
                                # Down Payment
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Down Payment *"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "input"
                                        props:
                                          placeholder: "$170,000 (20%)"
                                          value: "{{ mortgageCalculator.downPayment }}"
                                          onChange: "updateMortgageDownPayment"
                                          style:
                                            width: "100%"
                                            padding: "15px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "8px"
                                            fontSize: "16px"
                                            
                                # Interest Rate
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Interest Rate *"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "input"
                                        props:
                                          placeholder: "3.5"
                                          value: "{{ mortgageCalculator.interestRate }}"
                                          onChange: "updateMortgageRate"
                                          style:
                                            width: "100%"
                                            padding: "15px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "8px"
                                            fontSize: "16px"
                                            
                                # Loan Term
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Loan Term *"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#374151"
                                            
                                      - component: "select"
                                        props:
                                          value: "{{ mortgageCalculator.loanTerm }}"
                                          onChange: "updateMortgageTerm"
                                          options:
                                            - { value: "15", label: "15 years" }
                                            - { value: "20", label: "20 years" }
                                            - { value: "25", label: "25 years" }
                                            - { value: "30", label: "30 years" }
                                          style:
                                            width: "100%"
                                            padding: "15px"
                                            border: "1px solid #d1d5db"
                                            borderRadius: "8px"
                                            fontSize: "16px"
                                            
                          - component: "button"
                            props:
                              text: "💰 Calculate Payment"
                              onClick: "calculateMortgage"
                              style:
                                width: "100%"
                                backgroundColor: "#3b82f6"
                                color: "white"
                                padding: "18px"
                                border: "none"
                                borderRadius: "8px"
                                fontSize: "18px"
                                fontWeight: "bold"
                                cursor: "pointer"
                                marginBottom: "30px"
                                
                          # Results
                          - component: "conditional"
                            props:
                              condition: "{{ mortgageCalculator.monthlyPayment > 0 }}"
                              component:
                                component: "container"
                                props:
                                  style:
                                    backgroundColor: "#f0f9ff"
                                    border: "1px solid #0ea5e9"
                                    padding: "30px"
                                    borderRadius: "8px"
                                    textAlign: "center"
                                  children:
                                    - component: "display"
                                      props:
                                        text: "Your Monthly Payment"
                                        style:
                                          fontSize: "18px"
                                          color: "#0369a1"
                                          marginBottom: "10px"
                                          
                                    - component: "display"
                                      props:
                                        text: "${{ mortgageCalculator.monthlyPayment.toLocaleString() }}"
                                        style:
                                          fontSize: "36px"
                                          fontWeight: "bold"
                                          color: "#0c4a6e"
                                          
          # Property Comparison View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'comparison' }}"
              component:
                component: "container"
                props:
                  style:
                    maxWidth: "1400px"
                    margin: "0 auto"
                    padding: "30px 20px"
                  children:
                    - component: "display"
                      props:
                        text: "📊 Property Comparison"
                        style:
                          fontSize: "32px"
                          fontWeight: "bold"
                          marginBottom: "30px"
                          color: "#2c5aa0"
                          textAlign: "center"
                          
                    - component: "conditional"
                      props:
                        condition: "{{ comparisonList.length > 0 }}"
                        component:
                          component: "container"
                          props:
                            style:
                              display: "grid"
                              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))"
                              gap: "30px"
                            children:
                              - component: "list"
                                props:
                                  items: "{{ comparisonList }}"
                                  itemTemplate:
                                    component: "container"
                                    props:
                                      style:
                                        backgroundColor: "white"
                                        borderRadius: "12px"
                                        overflow: "hidden"
                                        boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                        position: "relative"
                                      children:
                                        # Remove Button
                                        - component: "button"
                                          props:
                                            text: "❌"
                                            onClick: "removeFromComparison"
                                            style:
                                              position: "absolute"
                                              top: "15px"
                                              right: "15px"
                                              backgroundColor: "white"
                                              border: "none"
                                              borderRadius: "50%"
                                              width: "30px"
                                              height: "30px"
                                              cursor: "pointer"
                                              zIndex: "10"
                                              
                                        # Property Image
                                        - component: "container"
                                          props:
                                            style:
                                              height: "200px"
                                              backgroundColor: "#e5e7eb"
                                              background: "{{ 'url(' + item.image + ')' }}"
                                              backgroundSize: "cover"
                                              backgroundPosition: "center"
                                              
                                        # Property Details
                                        - component: "container"
                                          props:
                                            style:
                                              padding: "25px"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "{{ item.title }}"
                                                  style:
                                                    fontSize: "18px"
                                                    fontWeight: "bold"
                                                    marginBottom: "15px"
                                                    
                                              - component: "container"
                                                props:
                                                  style:
                                                    display: "flex"
                                                    flexDirection: "column"
                                                    gap: "10px"
                                                  children:
                                                    - component: "display"
                                                      props:
                                                        text: "💰 ${{ item.price.toLocaleString() }}"
                                                        style:
                                                          fontSize: "20px"
                                                          fontWeight: "bold"
                                                          color: "#2c5aa0"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "🛏️ {{ item.bedrooms }} bedrooms"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#374151"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "🚿 {{ item.bathrooms }} bathrooms"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#374151"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "📐 {{ item.sqft.toLocaleString() }} sqft"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#374151"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "📍 {{ item.address }}"
                                                        style:
                                                          fontSize: "14px"
                                                          color: "#6b7280"
                                                          
                    - component: "conditional"
                      props:
                        condition: "{{ comparisonList.length === 0 }}"
                        component:
                          component: "container"
                          props:
                            style:
                              backgroundColor: "white"
                              padding: "60px"
                              borderRadius: "12px"
                              textAlign: "center"
                            children:
                              - component: "display"
                                props:
                                  text: "📊 No properties to compare"
                                  style:
                                    fontSize: "24px"
                                    color: "#6b7280"
                                    marginBottom: "15px"
                                    
                              - component: "display"
                                props:
                                  text: "Add properties from the listings to compare them side by side."
                                  style:
                                    color: "#9ca3af"
                                    marginBottom: "20px"
                                    
                              - component: "button"
                                props:
                                  text: "🏠 Back to Listings"
                                  onClick: "showListings"
                                  style:
                                    backgroundColor: "#3b82f6"
                                    color: "white"
                                    padding: "12px 24px"
                                    border: "none"
                                    borderRadius: "6px"
                                    cursor: "pointer"
                                    fontWeight: "600"

  actions:
    showListings:
      type: "setState"
      path: "currentView"
      value: "listings"
      
    showCalculator:
      type: "setState"
      path: "currentView"
      value: "calculator"
      
    showComparison:
      type: "setState"
      path: "currentView"
      value: "comparison"
      
    updateLocationFilter:
      type: "setState"
      path: "searchFilters.location"
      value: "{{ value }}"
      
    updatePropertyTypeFilter:
      type: "setState"
      path: "searchFilters.propertyType"
      value: "{{ value }}"
      
    updateBedroomsFilter:
      type: "setState"
      path: "searchFilters.bedrooms"
      value: "{{ value }}"
      
    updateBathroomsFilter:
      type: "setState"
      path: "searchFilters.bathrooms"
      value: "{{ value }}"
      
    updatePriceMinFilter:
      type: "setState"
      path: "searchFilters.priceMin"
      value: "{{ value }}"
      
    updatePriceMaxFilter:
      type: "setState"
      path: "searchFilters.priceMax"
      value: "{{ value }}"
      
    searchProperties:
      type: "alert"
      message: "Searching properties with current filters..."
      
    clearFilters:
      type: "setState"
      path: "searchFilters"
      value:
        priceMin: ""
        priceMax: ""
        bedrooms: ""
        bathrooms: ""
        propertyType: ""
        location: ""
        
    loadSampleProperties:
      type: "setState"
      path: "properties"
      value:
        - id: 1
          title: "Luxury Manhattan Penthouse"
          address: "123 Central Park West, Manhattan, NY"
          price: 2850000
          bedrooms: 3
          bathrooms: 3
          sqft: 2200
          propertyType: "Penthouse"
          image: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400"
          description: "Stunning penthouse with panoramic city views, high-end finishes, and premium location."
        - id: 2
          title: "Brooklyn Heights Townhouse"
          address: "456 Remsen St, Brooklyn Heights, NY"
          price: 1650000
          bedrooms: 4
          bathrooms: 3
          sqft: 2800
          propertyType: "Townhouse"
          image: "https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=400"
          description: "Historic townhouse with original details, private garden, and views of Manhattan skyline."
        - id: 3
          title: "Modern SoHo Loft"
          address: "789 Broadway, SoHo, Manhattan, NY"
          price: 1950000
          bedrooms: 2
          bathrooms: 2
          sqft: 1800
          propertyType: "Loft"
          image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400"
          description: "Contemporary loft with exposed brick, high ceilings, and premium SoHo location."
        - id: 4
          title: "Queens Family Home"
          address: "321 Oak Ave, Astoria, Queens, NY"
          price: 875000
          bedrooms: 4
          bathrooms: 3
          sqft: 2400
          propertyType: "House"
          image: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400"
          description: "Spacious family home with modern updates, large backyard, and excellent schools nearby."
        - id: 5
          title: "Upper East Side Condo"
          address: "654 Park Ave, Upper East Side, NY"
          price: 1350000
          bedrooms: 2
          bathrooms: 2
          sqft: 1400
          propertyType: "Condo"
          image: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400"
          description: "Elegant condo in prestigious building with doorman, gym, and rooftop terrace."
        - id: 6
          title: "Williamsburg Waterfront"
          address: "987 Kent Ave, Williamsburg, Brooklyn, NY"
          price: 2250000
          bedrooms: 3
          bathrooms: 2
          sqft: 1900
          propertyType: "Condo"
          image: "https://images.unsplash.com/photo-1567496898669-ee935f5f647a?w=400"
          description: "Waterfront condo with stunning river views, luxury amenities, and modern design."
          
    viewProperty:
      type: "setState"
      path: "selectedProperty"
      value: "{{ item }}"
      then:
        - type: "alert"
          message: "Viewing property: {{ item.title }}"
          
    toggleComparison:
      type: "setState"
      path: "comparisonList"
      value: "{{ comparisonList.some(p => p.id === item.id) ? comparisonList.filter(p => p.id !== item.id) : [...comparisonList, item] }}"
      
    removeFromComparison:
      type: "setState"
      path: "comparisonList"
      value: "{{ comparisonList.filter(p => p.id !== item.id) }}"
      
    contactAgent:
      type: "alert"
      message: "Contacting agent for property: {{ item.title }}"
      
    updateMortgagePrice:
      type: "setState"
      path: "mortgageCalculator.price"
      value: "{{ value }}"
      
    updateMortgageDownPayment:
      type: "setState"
      path: "mortgageCalculator.downPayment"
      value: "{{ value }}"
      
    updateMortgageRate:
      type: "setState"
      path: "mortgageCalculator.interestRate"
      value: "{{ value }}"
      
    updateMortgageTerm:
      type: "setState"
      path: "mortgageCalculator.loanTerm"
      value: "{{ value }}"
      
    calculateMortgage:
      type: "setState"
      path: "mortgageCalculator.monthlyPayment"
      value: 3542
      then:
        - type: "alert"
          message: "Mortgage calculated! Monthly payment: $3,542"
```