# Business Landing Page Template

```yaml
GLASSVIEW_APP:
  name: "Business Landing Page"
  description: "Professional landing page for businesses with contact forms and service showcases"
  category: "Marketing"
  difficulty: "Beginner"
  features:
    - "Hero section with call-to-action"
    - "Services showcase"
    - "About us section"
    - "Contact form"
    - "Customer testimonials"
    - "Responsive design"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Business Pro"
      theme:
        primaryColor: "#1a365d"
        secondaryColor: "#2d3748"
        backgroundColor: "#f7fafc"
        accentColor: "#3182ce"
      initialState:
        currentSection: "home"
        contactForm:
          name: ""
          email: ""
          phone: ""
          company: ""
          message: ""
          service: ""
        isContactFormSubmitted: false
        isMenuOpen: false
        
  layout:
    - component: "container"
      props:
        style:
          fontFamily: "Arial, sans-serif"
          backgroundColor: "#f7fafc"
          minHeight: "100vh"
        children:
          # Navigation Header
          - component: "container"
            props:
              style:
                position: "sticky"
                top: "0"
                backgroundColor: "white"
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                zIndex: "1000"
                padding: "15px 0"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1200px"
                      margin: "0 auto"
                      padding: "0 20px"
                      display: "flex"
                      justifyContent: "space-between"
                      alignItems: "center"
                    children:
                      # Logo
                      - component: "display"
                        props:
                          text: "🚀 BusinessPro"
                          style:
                            fontSize: "28px"
                            fontWeight: "bold"
                            color: "#1a365d"
                            
                      # Navigation Menu
                      - component: "container"
                        props:
                          style:
                            display: "flex"
                            gap: "30px"
                            alignItems: "center"
                          children:
                            - component: "button"
                              props:
                                text: "Home"
                                onClick: "scrollToHome"
                                style:
                                  background: "transparent"
                                  border: "none"
                                  color: "#1a365d"
                                  fontSize: "16px"
                                  cursor: "pointer"
                                  fontWeight: "500"
                                  
                            - component: "button"
                              props:
                                text: "Services"
                                onClick: "scrollToServices"
                                style:
                                  background: "transparent"
                                  border: "none"
                                  color: "#1a365d"
                                  fontSize: "16px"
                                  cursor: "pointer"
                                  fontWeight: "500"
                                  
                            - component: "button"
                              props:
                                text: "About"
                                onClick: "scrollToAbout"
                                style:
                                  background: "transparent"
                                  border: "none"
                                  color: "#1a365d"
                                  fontSize: "16px"
                                  cursor: "pointer"
                                  fontWeight: "500"
                                  
                            - component: "button"
                              props:
                                text: "Contact"
                                onClick: "scrollToContact"
                                style:
                                  backgroundColor: "#3182ce"
                                  color: "white"
                                  padding: "12px 24px"
                                  border: "none"
                                  borderRadius: "6px"
                                  fontSize: "16px"
                                  cursor: "pointer"
                                  fontWeight: "600"
                                  
          # Hero Section
          - component: "container"
            props:
              id: "home"
              style:
                background: "linear-gradient(135deg, #1a365d 0%, #2d3748 100%)"
                color: "white"
                padding: "120px 0"
                textAlign: "center"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1200px"
                      margin: "0 auto"
                      padding: "0 20px"
                    children:
                      - component: "display"
                        props:
                          text: "Transform Your Business with Professional Solutions"
                          style:
                            fontSize: "56px"
                            fontWeight: "bold"
                            lineHeight: "1.1"
                            marginBottom: "30px"
                            
                      - component: "display"
                        props:
                          text: "We help businesses grow and succeed with cutting-edge strategies, innovative solutions, and expert guidance tailored to your unique needs."
                          style:
                            fontSize: "22px"
                            lineHeight: "1.6"
                            marginBottom: "50px"
                            opacity: "0.9"
                            maxWidth: "800px"
                            margin: "0 auto"
                            
                      - component: "container"
                        props:
                          style:
                            display: "flex"
                            gap: "20px"
                            justifyContent: "center"
                            flexWrap: "wrap"
                          children:
                            - component: "button"
                              props:
                                text: "📞 Get Started Now"
                                onClick: "scrollToContact"
                                style:
                                  backgroundColor: "#3182ce"
                                  color: "white"
                                  padding: "18px 36px"
                                  border: "none"
                                  borderRadius: "8px"
                                  fontSize: "18px"
                                  fontWeight: "bold"
                                  cursor: "pointer"
                                  boxShadow: "0 4px 12px rgba(49, 130, 206, 0.3)"
                                  
                            - component: "button"
                              props:
                                text: "🎥 Watch Demo"
                                onClick: "playDemo"
                                style:
                                  backgroundColor: "transparent"
                                  color: "white"
                                  padding: "18px 36px"
                                  border: "2px solid white"
                                  borderRadius: "8px"
                                  fontSize: "18px"
                                  fontWeight: "bold"
                                  cursor: "pointer"
                                  
          # Services Section
          - component: "container"
            props:
              id: "services"
              style:
                padding: "100px 0"
                backgroundColor: "white"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1200px"
                      margin: "0 auto"
                      padding: "0 20px"
                    children:
                      - component: "display"
                        props:
                          text: "Our Services"
                          style:
                            fontSize: "42px"
                            fontWeight: "bold"
                            textAlign: "center"
                            marginBottom: "20px"
                            color: "#1a365d"
                            
                      - component: "display"
                        props:
                          text: "Comprehensive solutions to drive your business forward"
                          style:
                            fontSize: "20px"
                            textAlign: "center"
                            marginBottom: "60px"
                            color: "#4a5568"
                            
                      # Services Grid
                      - component: "container"
                        props:
                          style:
                            display: "grid"
                            gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))"
                            gap: "40px"
                          children:
                            # Service 1
                            - component: "container"
                              props:
                                style:
                                  backgroundColor: "#f7fafc"
                                  padding: "40px"
                                  borderRadius: "12px"
                                  textAlign: "center"
                                  border: "1px solid #e2e8f0"
                                  transition: "transform 0.3s"
                                children:
                                  - component: "display"
                                    props:
                                      text: "💼"
                                      style:
                                        fontSize: "48px"
                                        marginBottom: "20px"
                                        
                                  - component: "display"
                                    props:
                                      text: "Business Consulting"
                                      style:
                                        fontSize: "24px"
                                        fontWeight: "bold"
                                        marginBottom: "15px"
                                        color: "#1a365d"
                                        
                                  - component: "display"
                                    props:
                                      text: "Strategic guidance to optimize your operations, increase efficiency, and drive sustainable growth for your business."
                                      style:
                                        fontSize: "16px"
                                        lineHeight: "1.6"
                                        color: "#4a5568"
                                        
                            # Service 2
                            - component: "container"
                              props:
                                style:
                                  backgroundColor: "#f7fafc"
                                  padding: "40px"
                                  borderRadius: "12px"
                                  textAlign: "center"
                                  border: "1px solid #e2e8f0"
                                children:
                                  - component: "display"
                                    props:
                                      text: "🎯"
                                      style:
                                        fontSize: "48px"
                                        marginBottom: "20px"
                                        
                                  - component: "display"
                                    props:
                                      text: "Digital Marketing"
                                      style:
                                        fontSize: "24px"
                                        fontWeight: "bold"
                                        marginBottom: "15px"
                                        color: "#1a365d"
                                        
                                  - component: "display"
                                    props:
                                      text: "Comprehensive digital marketing strategies including SEO, social media, content marketing, and paid advertising campaigns."
                                      style:
                                        fontSize: "16px"
                                        lineHeight: "1.6"
                                        color: "#4a5568"
                                        
                            # Service 3
                            - component: "container"
                              props:
                                style:
                                  backgroundColor: "#f7fafc"
                                  padding: "40px"
                                  borderRadius: "12px"
                                  textAlign: "center"
                                  border: "1px solid #e2e8f0"
                                children:
                                  - component: "display"
                                    props:
                                      text: "⚙️"
                                      style:
                                        fontSize: "48px"
                                        marginBottom: "20px"
                                        
                                  - component: "display"
                                    props:
                                      text: "Technology Solutions"
                                      style:
                                        fontSize: "24px"
                                        fontWeight: "bold"
                                        marginBottom: "15px"
                                        color: "#1a365d"
                                        
                                  - component: "display"
                                    props:
                                      text: "Custom software development, system integration, and digital transformation to modernize your business processes."
                                      style:
                                        fontSize: "16px"
                                        lineHeight: "1.6"
                                        color: "#4a5568"
                                        
          # About Section
          - component: "container"
            props:
              id: "about"
              style:
                padding: "100px 0"
                backgroundColor: "#f7fafc"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1200px"
                      margin: "0 auto"
                      padding: "0 20px"
                    children:
                      - component: "container"
                        props:
                          style:
                            display: "grid"
                            gridTemplateColumns: "1fr 1fr"
                            gap: "80px"
                            alignItems: "center"
                          children:
                            # About Content
                            - component: "container"
                              props:
                                children:
                                  - component: "display"
                                    props:
                                      text: "About BusinessPro"
                                      style:
                                        fontSize: "42px"
                                        fontWeight: "bold"
                                        marginBottom: "30px"
                                        color: "#1a365d"
                                        
                                  - component: "display"
                                    props:
                                      text: "With over 10 years of experience, we've helped hundreds of businesses achieve their goals through innovative solutions and expert guidance."
                                      style:
                                        fontSize: "18px"
                                        lineHeight: "1.6"
                                        marginBottom: "25px"
                                        color: "#4a5568"
                                        
                                  - component: "display"
                                    props:
                                      text: "Our team of experts combines industry knowledge with cutting-edge technology to deliver results that exceed expectations."
                                      style:
                                        fontSize: "18px"
                                        lineHeight: "1.6"
                                        marginBottom: "30px"
                                        color: "#4a5568"
                                        
                                  - component: "container"
                                    props:
                                      style:
                                        display: "flex"
                                        flexDirection: "column"
                                        gap: "15px"
                                      children:
                                        - component: "display"
                                          props:
                                            text: "✅ 500+ Successful Projects"
                                            style:
                                              fontSize: "16px"
                                              fontWeight: "600"
                                              color: "#1a365d"
                                              
                                        - component: "display"
                                          props:
                                            text: "✅ 98% Client Satisfaction Rate"
                                            style:
                                              fontSize: "16px"
                                              fontWeight: "600"
                                              color: "#1a365d"
                                              
                                        - component: "display"
                                          props:
                                            text: "✅ 24/7 Support & Maintenance"
                                            style:
                                              fontSize: "16px"
                                              fontWeight: "600"
                                              color: "#1a365d"
                                              
                            # About Stats
                            - component: "container"
                              props:
                                style:
                                  backgroundColor: "white"
                                  padding: "50px"
                                  borderRadius: "12px"
                                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                                children:
                                  - component: "display"
                                    props:
                                      text: "Why Choose Us?"
                                      style:
                                        fontSize: "24px"
                                        fontWeight: "bold"
                                        marginBottom: "30px"
                                        color: "#1a365d"
                                        textAlign: "center"
                                        
                                  - component: "container"
                                    props:
                                      style:
                                        display: "grid"
                                        gridTemplateColumns: "1fr 1fr"
                                        gap: "30px"
                                      children:
                                        - component: "container"
                                          props:
                                            style:
                                              textAlign: "center"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "500+"
                                                  style:
                                                    fontSize: "36px"
                                                    fontWeight: "bold"
                                                    color: "#3182ce"
                                                    
                                              - component: "display"
                                                props:
                                                  text: "Projects"
                                                  style:
                                                    fontSize: "16px"
                                                    color: "#4a5568"
                                                    
                                        - component: "container"
                                          props:
                                            style:
                                              textAlign: "center"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "10+"
                                                  style:
                                                    fontSize: "36px"
                                                    fontWeight: "bold"
                                                    color: "#3182ce"
                                                    
                                              - component: "display"
                                                props:
                                                  text: "Years"
                                                  style:
                                                    fontSize: "16px"
                                                    color: "#4a5568"
                                                    
                                        - component: "container"
                                          props:
                                            style:
                                              textAlign: "center"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "98%"
                                                  style:
                                                    fontSize: "36px"
                                                    fontWeight: "bold"
                                                    color: "#3182ce"
                                                    
                                              - component: "display"
                                                props:
                                                  text: "Satisfaction"
                                                  style:
                                                    fontSize: "16px"
                                                    color: "#4a5568"
                                                    
                                        - component: "container"
                                          props:
                                            style:
                                              textAlign: "center"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "24/7"
                                                  style:
                                                    fontSize: "36px"
                                                    fontWeight: "bold"
                                                    color: "#3182ce"
                                                    
                                              - component: "display"
                                                props:
                                                  text: "Support"
                                                  style:
                                                    fontSize: "16px"
                                                    color: "#4a5568"
                                                    
          # Contact Section
          - component: "container"
            props:
              id: "contact"
              style:
                padding: "100px 0"
                backgroundColor: "white"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1200px"
                      margin: "0 auto"
                      padding: "0 20px"
                    children:
                      - component: "display"
                        props:
                          text: "Get In Touch"
                          style:
                            fontSize: "42px"
                            fontWeight: "bold"
                            textAlign: "center"
                            marginBottom: "20px"
                            color: "#1a365d"
                            
                      - component: "display"
                        props:
                          text: "Ready to transform your business? Let's discuss your project."
                          style:
                            fontSize: "20px"
                            textAlign: "center"
                            marginBottom: "60px"
                            color: "#4a5568"
                            
                      # Contact Form
                      - component: "conditional"
                        props:
                          condition: "{{ !isContactFormSubmitted }}"
                          component:
                            component: "container"
                            props:
                              style:
                                maxWidth: "600px"
                                margin: "0 auto"
                                backgroundColor: "#f7fafc"
                                padding: "50px"
                                borderRadius: "12px"
                              children:
                                - component: "container"
                                  props:
                                    style:
                                      display: "grid"
                                      gridTemplateColumns: "1fr 1fr"
                                      gap: "20px"
                                      marginBottom: "20px"
                                    children:
                                      - component: "container"
                                        props:
                                          children:
                                            - component: "display"
                                              props:
                                                text: "Full Name *"
                                                style:
                                                  fontSize: "14px"
                                                  fontWeight: "600"
                                                  marginBottom: "8px"
                                                  color: "#1a365d"
                                                  
                                            - component: "input"
                                              props:
                                                placeholder: "Your full name"
                                                value: "{{ contactForm.name }}"
                                                onChange: "updateContactName"
                                                style:
                                                  width: "100%"
                                                  padding: "15px"
                                                  border: "1px solid #e2e8f0"
                                                  borderRadius: "6px"
                                                  fontSize: "16px"
                                                  
                                      - component: "container"
                                        props:
                                          children:
                                            - component: "display"
                                              props:
                                                text: "Email *"
                                                style:
                                                  fontSize: "14px"
                                                  fontWeight: "600"
                                                  marginBottom: "8px"
                                                  color: "#1a365d"
                                                  
                                            - component: "input"
                                              props:
                                                placeholder: "your.email@company.com"
                                                value: "{{ contactForm.email }}"
                                                onChange: "updateContactEmail"
                                                style:
                                                  width: "100%"
                                                  padding: "15px"
                                                  border: "1px solid #e2e8f0"
                                                  borderRadius: "6px"
                                                  fontSize: "16px"
                                                  
                                - component: "container"
                                  props:
                                    style:
                                      display: "grid"
                                      gridTemplateColumns: "1fr 1fr"
                                      gap: "20px"
                                      marginBottom: "20px"
                                    children:
                                      - component: "container"
                                        props:
                                          children:
                                            - component: "display"
                                              props:
                                                text: "Phone"
                                                style:
                                                  fontSize: "14px"
                                                  fontWeight: "600"
                                                  marginBottom: "8px"
                                                  color: "#1a365d"
                                                  
                                            - component: "input"
                                              props:
                                                placeholder: "+1 (555) 123-4567"
                                                value: "{{ contactForm.phone }}"
                                                onChange: "updateContactPhone"
                                                style:
                                                  width: "100%"
                                                  padding: "15px"
                                                  border: "1px solid #e2e8f0"
                                                  borderRadius: "6px"
                                                  fontSize: "16px"
                                                  
                                      - component: "container"
                                        props:
                                          children:
                                            - component: "display"
                                              props:
                                                text: "Company"
                                                style:
                                                  fontSize: "14px"
                                                  fontWeight: "600"
                                                  marginBottom: "8px"
                                                  color: "#1a365d"
                                                  
                                            - component: "input"
                                              props:
                                                placeholder: "Your company name"
                                                value: "{{ contactForm.company }}"
                                                onChange: "updateContactCompany"
                                                style:
                                                  width: "100%"
                                                  padding: "15px"
                                                  border: "1px solid #e2e8f0"
                                                  borderRadius: "6px"
                                                  fontSize: "16px"
                                                  
                                - component: "container"
                                  props:
                                    style:
                                      marginBottom: "20px"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Service Interest"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#1a365d"
                                            
                                      - component: "select"
                                        props:
                                          value: "{{ contactForm.service }}"
                                          onChange: "updateContactService"
                                          options:
                                            - { value: "", label: "Select a service" }
                                            - { value: "consulting", label: "Business Consulting" }
                                            - { value: "marketing", label: "Digital Marketing" }
                                            - { value: "technology", label: "Technology Solutions" }
                                            - { value: "other", label: "Other" }
                                          style:
                                            width: "100%"
                                            padding: "15px"
                                            border: "1px solid #e2e8f0"
                                            borderRadius: "6px"
                                            fontSize: "16px"
                                            
                                - component: "container"
                                  props:
                                    style:
                                      marginBottom: "30px"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "Message *"
                                          style:
                                            fontSize: "14px"
                                            fontWeight: "600"
                                            marginBottom: "8px"
                                            color: "#1a365d"
                                            
                                      - component: "input"
                                        props:
                                          placeholder: "Tell us about your project and how we can help..."
                                          value: "{{ contactForm.message }}"
                                          onChange: "updateContactMessage"
                                          multiline: true
                                          rows: 4
                                          style:
                                            width: "100%"
                                            padding: "15px"
                                            border: "1px solid #e2e8f0"
                                            borderRadius: "6px"
                                            fontSize: "16px"
                                            fontFamily: "inherit"
                                            
                                - component: "button"
                                  props:
                                    text: "📧 Send Message"
                                    onClick: "submitContactForm"
                                    style:
                                      width: "100%"
                                      backgroundColor: "#3182ce"
                                      color: "white"
                                      padding: "18px"
                                      border: "none"
                                      borderRadius: "8px"
                                      fontSize: "18px"
                                      fontWeight: "bold"
                                      cursor: "pointer"
                                      
                      # Thank You Message
                      - component: "conditional"
                        props:
                          condition: "{{ isContactFormSubmitted }}"
                          component:
                            component: "container"
                            props:
                              style:
                                maxWidth: "600px"
                                margin: "0 auto"
                                backgroundColor: "#f0fff4"
                                border: "1px solid #68d391"
                                padding: "50px"
                                borderRadius: "12px"
                                textAlign: "center"
                              children:
                                - component: "display"
                                  props:
                                    text: "✅ Thank You!"
                                    style:
                                      fontSize: "32px"
                                      fontWeight: "bold"
                                      marginBottom: "20px"
                                      color: "#22543d"
                                      
                                - component: "display"
                                  props:
                                    text: "We've received your message and will get back to you within 24 hours."
                                    style:
                                      fontSize: "18px"
                                      lineHeight: "1.6"
                                      color: "#2f855a"
                                      marginBottom: "30px"
                                      
                                - component: "button"
                                  props:
                                    text: "Send Another Message"
                                    onClick: "resetContactForm"
                                    style:
                                      backgroundColor: "#3182ce"
                                      color: "white"
                                      padding: "12px 24px"
                                      border: "none"
                                      borderRadius: "6px"
                                      fontSize: "16px"
                                      cursor: "pointer"
                                      
          # Footer
          - component: "container"
            props:
              style:
                backgroundColor: "#1a365d"
                color: "white"
                padding: "60px 0 30px"
              children:
                - component: "container"
                  props:
                    style:
                      maxWidth: "1200px"
                      margin: "0 auto"
                      padding: "0 20px"
                    children:
                      - component: "container"
                        props:
                          style:
                            display: "grid"
                            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))"
                            gap: "40px"
                            marginBottom: "40px"
                          children:
                            # Company Info
                            - component: "container"
                              props:
                                children:
                                  - component: "display"
                                    props:
                                      text: "🚀 BusinessPro"
                                      style:
                                        fontSize: "24px"
                                        fontWeight: "bold"
                                        marginBottom: "15px"
                                        
                                  - component: "display"
                                    props:
                                      text: "Transforming businesses with innovative solutions and expert guidance."
                                      style:
                                        fontSize: "16px"
                                        lineHeight: "1.6"
                                        opacity: "0.8"
                                        
                            # Contact Info
                            - component: "container"
                              props:
                                children:
                                  - component: "display"
                                    props:
                                      text: "Contact Info"
                                      style:
                                        fontSize: "18px"
                                        fontWeight: "bold"
                                        marginBottom: "15px"
                                        
                                  - component: "display"
                                    props:
                                      text: "📧 hello@businesspro.com\n📞 +1 (555) 123-4567\n📍 123 Business Street\n    City, State 12345"
                                      style:
                                        fontSize: "14px"
                                        lineHeight: "1.8"
                                        opacity: "0.8"
                                        whiteSpace: "pre-line"
                                        
                            # Quick Links
                            - component: "container"
                              props:
                                children:
                                  - component: "display"
                                    props:
                                      text: "Quick Links"
                                      style:
                                        fontSize: "18px"
                                        fontWeight: "bold"
                                        marginBottom: "15px"
                                        
                                  - component: "container"
                                    props:
                                      style:
                                        display: "flex"
                                        flexDirection: "column"
                                        gap: "8px"
                                      children:
                                        - component: "button"
                                          props:
                                            text: "Home"
                                            onClick: "scrollToHome"
                                            style:
                                              background: "transparent"
                                              border: "none"
                                              color: "white"
                                              fontSize: "14px"
                                              cursor: "pointer"
                                              textAlign: "left"
                                              padding: "0"
                                              opacity: "0.8"
                                              
                                        - component: "button"
                                          props:
                                            text: "Services"
                                            onClick: "scrollToServices"
                                            style:
                                              background: "transparent"
                                              border: "none"
                                              color: "white"
                                              fontSize: "14px"
                                              cursor: "pointer"
                                              textAlign: "left"
                                              padding: "0"
                                              opacity: "0.8"
                                              
                                        - component: "button"
                                          props:
                                            text: "About"
                                            onClick: "scrollToAbout"
                                            style:
                                              background: "transparent"
                                              border: "none"
                                              color: "white"
                                              fontSize: "14px"
                                              cursor: "pointer"
                                              textAlign: "left"
                                              padding: "0"
                                              opacity: "0.8"
                                              
                                        - component: "button"
                                          props:
                                            text: "Contact"
                                            onClick: "scrollToContact"
                                            style:
                                              background: "transparent"
                                              border: "none"
                                              color: "white"
                                              fontSize: "14px"
                                              cursor: "pointer"
                                              textAlign: "left"
                                              padding: "0"
                                              opacity: "0.8"
                                              
                      - component: "container"
                        props:
                          style:
                            borderTop: "1px solid rgba(255,255,255,0.2)"
                            paddingTop: "20px"
                            textAlign: "center"
                          children:
                            - component: "display"
                              props:
                                text: "© 2024 BusinessPro. All rights reserved."
                                style:
                                  opacity: "0.6"
                                  fontSize: "14px"

  actions:
    scrollToHome:
      type: "alert"
      message: "Scrolling to Home section"
      
    scrollToServices:
      type: "alert"
      message: "Scrolling to Services section"
      
    scrollToAbout:
      type: "alert"
      message: "Scrolling to About section"
      
    scrollToContact:
      type: "alert"
      message: "Scrolling to Contact section"
      
    playDemo:
      type: "alert"
      message: "Demo video would play here"
      
    updateContactName:
      type: "setState"
      path: "contactForm.name"
      value: "{{ value }}"
      
    updateContactEmail:
      type: "setState"
      path: "contactForm.email"
      value: "{{ value }}"
      
    updateContactPhone:
      type: "setState"
      path: "contactForm.phone"
      value: "{{ value }}"
      
    updateContactCompany:
      type: "setState"
      path: "contactForm.company"
      value: "{{ value }}"
      
    updateContactService:
      type: "setState"
      path: "contactForm.service"
      value: "{{ value }}"
      
    updateContactMessage:
      type: "setState"
      path: "contactForm.message"
      value: "{{ value }}"
      
    submitContactForm:
      type: "setState"
      path: "isContactFormSubmitted"
      value: true
      then:
        - type: "alert"
          message: "Thank you! We'll be in touch soon."
          
    resetContactForm:
      type: "setState"
      path: "isContactFormSubmitted"
      value: false
      then:
        - type: "setState"
          path: "contactForm"
          value:
            name: ""
            email: ""
            phone: ""
            company: ""
            message: ""
            service: ""
```