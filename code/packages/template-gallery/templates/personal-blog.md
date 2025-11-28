# Simple Blog Template

```yaml
GLASSVIEW_APP:
  name: "Personal Blog"
  description: "Clean and simple blog for sharing articles and thoughts"
  category: "Content"
  difficulty: "Beginner"
  features:
    - "Article listing and reading"
    - "Category filtering"
    - "Search functionality"
    - "Comment system"
    - "Author information"
    - "Social sharing"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "My Blog"
      theme:
        primaryColor: "#2c3e50"
        secondaryColor: "#34495e"
        backgroundColor: "#ffffff"
        accentColor: "#3498db"
      initialState:
        currentView: "home"
        articles: []
        currentArticle: null
        searchQuery: ""
        selectedCategory: "all"
        comments: []
        
  layout:
    - component: "container"
      props:
        style:
          maxWidth: "900px"
          margin: "0 auto"
          padding: "20px"
        children:
          # Header
          - component: "container"
            props:
              style:
                textAlign: "center"
                marginBottom: "40px"
                padding: "40px 20px"
                backgroundColor: "#2c3e50"
                color: "white"
                borderRadius: "12px"
              children:
                - component: "display"
                  props:
                    text: "✍️ My Personal Blog"
                    style:
                      fontSize: "36px"
                      fontWeight: "bold"
                      marginBottom: "10px"
                      
                - component: "display"
                  props:
                    text: "Thoughts, stories, and ideas"
                    style:
                      fontSize: "18px"
                      opacity: "0.9"
                      
          # Navigation
          - component: "container"
            props:
              style:
                display: "flex"
                justifyContent: "center"
                gap: "20px"
                marginBottom: "30px"
              children:
                - component: "button"
                  props:
                    text: "🏠 Home"
                    onClick: "showHome"
                    style:
                      backgroundColor: "{{ currentView === 'home' ? '#3498db' : 'transparent' }}"
                      color: "{{ currentView === 'home' ? 'white' : '#2c3e50' }}"
                      padding: "10px 20px"
                      border: "2px solid #3498db"
                      borderRadius: "25px"
                      cursor: "pointer"
                      fontWeight: "bold"
                      
                - component: "button"
                  props:
                    text: "📝 Articles"
                    onClick: "showArticles"
                    style:
                      backgroundColor: "{{ currentView === 'articles' ? '#3498db' : 'transparent' }}"
                      color: "{{ currentView === 'articles' ? 'white' : '#2c3e50' }}"
                      padding: "10px 20px"
                      border: "2px solid #3498db"
                      borderRadius: "25px"
                      cursor: "pointer"
                      fontWeight: "bold"
                      
                - component: "button"
                  props:
                    text: "👨‍💻 About"
                    onClick: "showAbout"
                    style:
                      backgroundColor: "{{ currentView === 'about' ? '#3498db' : 'transparent' }}"
                      color: "{{ currentView === 'about' ? 'white' : '#2c3e50' }}"
                      padding: "10px 20px"
                      border: "2px solid #3498db"
                      borderRadius: "25px"
                      cursor: "pointer"
                      fontWeight: "bold"
                      
          # Home View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'home' }}"
              component:
                component: "container"
                props:
                  children:
                    - component: "display"
                      props:
                        text: "🌟 Welcome to my blog!"
                        style:
                          fontSize: "28px"
                          fontWeight: "bold"
                          textAlign: "center"
                          marginBottom: "20px"
                          color: "#2c3e50"
                          
                    - component: "display"
                      props:
                        text: "Here you'll find my thoughts on technology, life, and everything in between. I write about web development, programming tips, and personal experiences."
                        style:
                          fontSize: "18px"
                          lineHeight: "1.6"
                          textAlign: "center"
                          marginBottom: "40px"
                          color: "#7f8c8d"
                          
                    - component: "display"
                      props:
                        text: "📚 Latest Articles"
                        style:
                          fontSize: "24px"
                          fontWeight: "bold"
                          marginBottom: "20px"
                          color: "#2c3e50"
                          
                    - component: "conditional"
                      props:
                        condition: "{{ articles.length > 0 }}"
                        component:
                          component: "list"
                          props:
                            items: "{{ articles.slice(0, 3) }}"
                            itemTemplate:
                              component: "container"
                              props:
                                style:
                                  backgroundColor: "white"
                                  border: "1px solid #ecf0f1"
                                  borderRadius: "12px"
                                  padding: "25px"
                                  marginBottom: "20px"
                                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                  cursor: "pointer"
                                  transition: "transform 0.2s"
                                onClick: "readArticle"
                                children:
                                  - component: "display"
                                    props:
                                      text: "{{ item.title }}"
                                      style:
                                        fontSize: "20px"
                                        fontWeight: "bold"
                                        marginBottom: "10px"
                                        color: "#2c3e50"
                                        
                                  - component: "display"
                                    props:
                                      text: "{{ item.excerpt }}"
                                      style:
                                        color: "#7f8c8d"
                                        lineHeight: "1.5"
                                        marginBottom: "15px"
                                        
                                  - component: "container"
                                    props:
                                      style:
                                        display: "flex"
                                        justifyContent: "space-between"
                                        alignItems: "center"
                                      children:
                                        - component: "display"
                                          props:
                                            text: "📅 {{ item.date }}"
                                            style:
                                              fontSize: "14px"
                                              color: "#95a5a6"
                                              
                                        - component: "display"
                                          props:
                                            text: "{{ item.category }}"
                                            style:
                                              padding: "4px 12px"
                                              backgroundColor: "#3498db"
                                              color: "white"
                                              borderRadius: "15px"
                                              fontSize: "12px"
                                              
          # Articles View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'articles' }}"
              component:
                component: "container"
                props:
                  children:
                    - component: "display"
                      props:
                        text: "📚 All Articles"
                        style:
                          fontSize: "28px"
                          fontWeight: "bold"
                          marginBottom: "30px"
                          color: "#2c3e50"
                          
                    # Search and Filter
                    - component: "container"
                      props:
                        style:
                          display: "flex"
                          gap: "15px"
                          marginBottom: "30px"
                          flexWrap: "wrap"
                        children:
                          - component: "input"
                            props:
                              placeholder: "Search articles..."
                              value: "{{ searchQuery }}"
                              onChange: "updateSearch"
                              style:
                                flex: "1"
                                minWidth: "250px"
                                padding: "12px"
                                border: "1px solid #bdc3c7"
                                borderRadius: "8px"
                                fontSize: "16px"
                                
                          - component: "select"
                            props:
                              value: "{{ selectedCategory }}"
                              onChange: "filterByCategory"
                              options:
                                - { value: "all", label: "All Categories" }
                                - { value: "technology", label: "Technology" }
                                - { value: "programming", label: "Programming" }
                                - { value: "life", label: "Life" }
                                - { value: "tutorials", label: "Tutorials" }
                              style:
                                padding: "12px"
                                border: "1px solid #bdc3c7"
                                borderRadius: "8px"
                                
                          - component: "button"
                            props:
                              text: "🔍 Search"
                              onClick: "searchArticles"
                              style:
                                backgroundColor: "#3498db"
                                color: "white"
                                padding: "12px 20px"
                                border: "none"
                                borderRadius: "8px"
                                cursor: "pointer"
                                
                    # Articles List
                    - component: "conditional"
                      props:
                        condition: "{{ articles.length > 0 }}"
                        component:
                          component: "list"
                          props:
                            items: "{{ articles }}"
                            itemTemplate:
                              component: "container"
                              props:
                                style:
                                  backgroundColor: "white"
                                  border: "1px solid #ecf0f1"
                                  borderRadius: "12px"
                                  padding: "25px"
                                  marginBottom: "20px"
                                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                  cursor: "pointer"
                                onClick: "readArticle"
                                children:
                                  - component: "display"
                                    props:
                                      text: "{{ item.title }}"
                                      style:
                                        fontSize: "22px"
                                        fontWeight: "bold"
                                        marginBottom: "12px"
                                        color: "#2c3e50"
                                        
                                  - component: "display"
                                    props:
                                      text: "{{ item.excerpt }}"
                                      style:
                                        color: "#7f8c8d"
                                        lineHeight: "1.6"
                                        marginBottom: "15px"
                                        fontSize: "16px"
                                        
                                  - component: "container"
                                    props:
                                      style:
                                        display: "flex"
                                        justifyContent: "space-between"
                                        alignItems: "center"
                                        flexWrap: "wrap"
                                        gap: "10px"
                                      children:
                                        - component: "container"
                                          props:
                                            style:
                                              display: "flex"
                                              alignItems: "center"
                                              gap: "15px"
                                            children:
                                              - component: "display"
                                                props:
                                                  text: "📅 {{ item.date }}"
                                                  style:
                                                    fontSize: "14px"
                                                    color: "#95a5a6"
                                                    
                                              - component: "display"
                                                props:
                                                  text: "🕒 {{ item.readTime }} min read"
                                                  style:
                                                    fontSize: "14px"
                                                    color: "#95a5a6"
                                                    
                                        - component: "display"
                                          props:
                                            text: "{{ item.category }}"
                                            style:
                                              padding: "6px 15px"
                                              backgroundColor: "#3498db"
                                              color: "white"
                                              borderRadius: "20px"
                                              fontSize: "12px"
                                              fontWeight: "bold"
                                              
                    - component: "conditional"
                      props:
                        condition: "{{ articles.length === 0 }}"
                        component:
                          component: "container"
                          props:
                            style:
                              textAlign: "center"
                              padding: "60px"
                              backgroundColor: "white"
                              borderRadius: "12px"
                            children:
                              - component: "display"
                                props:
                                  text: "📝 No articles yet"
                                  style:
                                    fontSize: "24px"
                                    color: "#7f8c8d"
                                    marginBottom: "10px"
                                    
                              - component: "display"
                                props:
                                  text: "Check back soon for new content!"
                                  style:
                                    color: "#95a5a6"
                                    
          # About View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'about' }}"
              component:
                component: "container"
                props:
                  style:
                    backgroundColor: "white"
                    padding: "40px"
                    borderRadius: "12px"
                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                  children:
                    - component: "display"
                      props:
                        text: "👨‍💻 About Me"
                        style:
                          fontSize: "28px"
                          fontWeight: "bold"
                          marginBottom: "20px"
                          color: "#2c3e50"
                          
                    - component: "display"
                      props:
                        text: "Hi! I'm a passionate web developer and technology enthusiast. I love writing about programming, sharing tutorials, and documenting my journey in the tech world."
                        style:
                          fontSize: "18px"
                          lineHeight: "1.6"
                          marginBottom: "20px"
                          color: "#7f8c8d"
                          
                    - component: "display"
                      props:
                        text: "🔧 Skills & Interests"
                        style:
                          fontSize: "20px"
                          fontWeight: "bold"
                          marginBottom: "15px"
                          color: "#2c3e50"
                          
                    - component: "display"
                      props:
                        text: "• JavaScript, TypeScript, React, Node.js\n• Web Development & UI/UX Design\n• Cloud Computing & DevOps\n• Open Source Contributions\n• Technical Writing & Blogging"
                        style:
                          fontSize: "16px"
                          lineHeight: "2"
                          marginBottom: "30px"
                          color: "#7f8c8d"
                          whiteSpace: "pre-line"
                          
                    - component: "display"
                      props:
                        text: "📫 Get in Touch"
                        style:
                          fontSize: "20px"
                          fontWeight: "bold"
                          marginBottom: "15px"
                          color: "#2c3e50"
                          
                    - component: "display"
                      props:
                        text: "Feel free to reach out if you have any questions or just want to connect!"
                        style:
                          fontSize: "16px"
                          marginBottom: "20px"
                          color: "#7f8c8d"
                          
                    - component: "container"
                      props:
                        style:
                          display: "flex"
                          gap: "15px"
                          flexWrap: "wrap"
                        children:
                          - component: "button"
                            props:
                              text: "📧 Email"
                              onClick: "contactEmail"
                              style:
                                backgroundColor: "#3498db"
                                color: "white"
                                padding: "10px 20px"
                                border: "none"
                                borderRadius: "8px"
                                cursor: "pointer"
                                
                          - component: "button"
                            props:
                              text: "🐦 Twitter"
                              onClick: "contactTwitter"
                              style:
                                backgroundColor: "#1da1f2"
                                color: "white"
                                padding: "10px 20px"
                                border: "none"
                                borderRadius: "8px"
                                cursor: "pointer"
                                
                          - component: "button"
                            props:
                              text: "💼 LinkedIn"
                              onClick: "contactLinkedIn"
                              style:
                                backgroundColor: "#0077b5"
                                color: "white"
                                padding: "10px 20px"
                                border: "none"
                                borderRadius: "8px"
                                cursor: "pointer"
                                
          # Article Reader View
          - component: "conditional"
            props:
              condition: "{{ currentView === 'reader' && currentArticle !== null }}"
              component:
                component: "container"
                props:
                  style:
                    backgroundColor: "white"
                    padding: "40px"
                    borderRadius: "12px"
                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                  children:
                    - component: "button"
                      props:
                        text: "← Back to Articles"
                        onClick: "backToArticles"
                        style:
                          backgroundColor: "transparent"
                          color: "#3498db"
                          padding: "10px 0"
                          border: "none"
                          cursor: "pointer"
                          marginBottom: "30px"
                          
                    - component: "display"
                      props:
                        text: "{{ currentArticle?.title }}"
                        style:
                          fontSize: "32px"
                          fontWeight: "bold"
                          marginBottom: "20px"
                          color: "#2c3e50"
                          lineHeight: "1.2"
                          
                    - component: "container"
                      props:
                        style:
                          display: "flex"
                          alignItems: "center"
                          gap: "20px"
                          marginBottom: "30px"
                          paddingBottom: "20px"
                          borderBottom: "1px solid #ecf0f1"
                        children:
                          - component: "display"
                            props:
                              text: "📅 {{ currentArticle?.date }}"
                              style:
                                color: "#7f8c8d"
                                
                          - component: "display"
                            props:
                              text: "🕒 {{ currentArticle?.readTime }} min read"
                              style:
                                color: "#7f8c8d"
                                
                          - component: "display"
                            props:
                              text: "{{ currentArticle?.category }}"
                              style:
                                padding: "6px 15px"
                                backgroundColor: "#3498db"
                                color: "white"
                                borderRadius: "20px"
                                fontSize: "12px"
                                
                    - component: "display"
                      props:
                        text: "{{ currentArticle?.content }}"
                        style:
                          fontSize: "18px"
                          lineHeight: "1.8"
                          color: "#2c3e50"
                          whiteSpace: "pre-line"

  actions:
    showHome:
      type: "setState"
      path: "currentView"
      value: "home"
      
    showArticles:
      type: "setState"
      path: "currentView"
      value: "articles"
      then:
        - type: "setState"
          path: "articles"
          value: "{{ [
            { id: 1, title: 'Getting Started with React Hooks', excerpt: 'Learn the fundamentals of React Hooks and how they can simplify your component logic.', content: 'React Hooks revolutionized how we write React components. In this article, we\\'ll explore useState, useEffect, and custom hooks...\\n\\nHooks allow you to use state and other React features without writing a class component. They make your code more readable and easier to test.\\n\\nLet\\'s start with useState, which lets you add state to functional components...', category: 'programming', date: '2024-12-01', readTime: 5 },
            { id: 2, title: 'The Future of Web Development', excerpt: 'Exploring emerging trends and technologies that will shape web development in the coming years.', content: 'Web development is constantly evolving. From new frameworks to improved browser APIs, there\\'s always something new to learn...\\n\\nSome key trends I\\'m watching:\\n- WebAssembly adoption\\n- Progressive Web Apps\\n- Serverless architecture\\n- AI-powered development tools\\n\\nEach of these technologies has the potential to significantly impact how we build web applications.', category: 'technology', date: '2024-11-28', readTime: 8 },
            { id: 3, title: 'Building Better APIs with TypeScript', excerpt: 'Learn how TypeScript can help you create more robust and maintainable REST APIs.', content: 'TypeScript brings type safety to JavaScript, making it an excellent choice for building APIs...\\n\\nIn this tutorial, we\\'ll build a REST API using Express and TypeScript. You\\'ll learn how to:\\n\\n1. Set up a TypeScript project\\n2. Define types for your data models\\n3. Create type-safe route handlers\\n4. Handle errors gracefully\\n\\nBy the end, you\\'ll have a solid foundation for building production-ready APIs.', category: 'tutorials', date: '2024-11-25', readTime: 12 },
            { id: 4, title: 'Work-Life Balance in Tech', excerpt: 'Thoughts on maintaining mental health and productivity in the fast-paced tech industry.', content: 'Working in tech can be incredibly rewarding, but it can also be overwhelming...\\n\\nI\\'ve learned that sustainable productivity comes from balance, not just working harder. Here are some strategies that have helped me:\\n\\n- Setting clear boundaries between work and personal time\\n- Taking regular breaks throughout the day\\n- Investing in hobbies outside of technology\\n- Building meaningful relationships with colleagues\\n\\nRemember, your worth isn\\'t determined by how many hours you work or how many features you ship.', category: 'life', date: '2024-11-20', readTime: 6 }
          ] }}"
      
    showAbout:
      type: "setState"
      path: "currentView"
      value: "about"
      
    updateSearch:
      type: "setState"
      path: "searchQuery"
      value: "{{ value }}"
      
    filterByCategory:
      type: "setState"
      path: "selectedCategory"
      value: "{{ value }}"
      
    searchArticles:
      type: "setState"
      path: "articles"
      value: "{{ articles }}"
      
    readArticle:
      type: "setState"
      path: "currentArticle"
      value: "{{ item }}"
      then:
        - type: "setState"
          path: "currentView"
          value: "reader"
          
    backToArticles:
      type: "setState"
      path: "currentView"
      value: "articles"
      
    contactEmail:
      type: "alert"
      message: "Email: hello@myblog.com"
      
    contactTwitter:
      type: "alert"
      message: "Twitter: @myblog"
      
    contactLinkedIn:
      type: "alert"
      message: "LinkedIn: linkedin.com/in/myblog"
```