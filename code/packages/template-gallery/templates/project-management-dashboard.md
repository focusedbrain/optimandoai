# Project Management Dashboard Template

```yaml
GLASSVIEW_APP:
  name: "Project Management Dashboard"
  description: "Complete project management solution with tasks, team members, and progress tracking"
  category: "Business"
  difficulty: "Advanced"
  features:
    - "Project overview and statistics"
    - "Task management with status tracking"
    - "Team member assignment and workload"
    - "Progress tracking and deadlines"
    - "File attachments and comments"
    - "Gantt chart visualization"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Project Manager Pro"
      theme:
        primaryColor: "#8e44ad"
        secondaryColor: "#2c3e50"
        backgroundColor: "#f4f6f9"
        accentColor: "#3498db"
        successColor: "#27ae60"
        warningColor: "#f39c12"
        dangerColor: "#e74c3c"
      initialState:
        currentView: "dashboard"
        selectedProject: null
        projects: []
        tasks: []
        teamMembers: []
        currentTask: null
        showTaskModal: false
        showProjectModal: false
        filterStatus: "all"
        filterAssignee: "all"
        
  layout:
    - component: "container"
      props:
        style:
          display: "flex"
          height: "100vh"
        children:
          # Sidebar Navigation
          - component: "container"
            props:
              style:
                width: "250px"
                backgroundColor: "#2c3e50"
                color: "white"
                padding: "20px"
                display: "flex"
                flexDirection: "column"
              children:
                - component: "display"
                  props:
                    text: "📊 Project Manager"
                    style:
                      fontSize: "20px"
                      fontWeight: "bold"
                      marginBottom: "30px"
                      textAlign: "center"
                      
                - component: "container"
                  props:
                    style:
                      display: "flex"
                      flexDirection: "column"
                      gap: "10px"
                    children:
                      - component: "button"
                        props:
                          text: "🏠 Dashboard"
                          onClick: "switchView"
                          data:
                            view: "dashboard"
                          style:
                            backgroundColor: "{{ currentView === 'dashboard' ? '#8e44ad' : 'transparent' }}"
                            color: "white"
                            padding: "12px"
                            border: "none"
                            borderRadius: "6px"
                            textAlign: "left"
                            cursor: "pointer"
                            
                      - component: "button"
                        props:
                          text: "📋 Projects"
                          onClick: "switchView"
                          data:
                            view: "projects"
                          style:
                            backgroundColor: "{{ currentView === 'projects' ? '#8e44ad' : 'transparent' }}"
                            color: "white"
                            padding: "12px"
                            border: "none"
                            borderRadius: "6px"
                            textAlign: "left"
                            cursor: "pointer"
                            
                      - component: "button"
                        props:
                          text: "✅ Tasks"
                          onClick: "switchView"
                          data:
                            view: "tasks"
                          style:
                            backgroundColor: "{{ currentView === 'tasks' ? '#8e44ad' : 'transparent' }}"
                            color: "white"
                            padding: "12px"
                            border: "none"
                            borderRadius: "6px"
                            textAlign: "left"
                            cursor: "pointer"
                            
                      - component: "button"
                        props:
                          text: "👥 Team"
                          onClick: "switchView"
                          data:
                            view: "team"
                          style:
                            backgroundColor: "{{ currentView === 'team' ? '#8e44ad' : 'transparent' }}"
                            color: "white"
                            padding: "12px"
                            border: "none"
                            borderRadius: "6px"
                            textAlign: "left"
                            cursor: "pointer"
                            
                - component: "container"
                  props:
                    style:
                      marginTop: "auto"
                      paddingTop: "20px"
                      borderTop: "1px solid #34495e"
                    children:
                      - component: "button"
                        props:
                          text: "➕ New Project"
                          onClick: "showNewProject"
                          style:
                            width: "100%"
                            backgroundColor: "#27ae60"
                            color: "white"
                            padding: "12px"
                            border: "none"
                            borderRadius: "6px"
                            cursor: "pointer"
                            fontWeight: "bold"
                            
          # Main Content Area
          - component: "container"
            props:
              style:
                flex: "1"
                padding: "30px"
                overflow: "auto"
              children:
                # Dashboard View
                - component: "conditional"
                  props:
                    condition: "{{ currentView === 'dashboard' }}"
                    component:
                      component: "container"
                      props:
                        children:
                          - component: "display"
                            props:
                              text: "📊 Dashboard Overview"
                              style:
                                fontSize: "28px"
                                fontWeight: "bold"
                                marginBottom: "30px"
                                color: "#2c3e50"
                                
                          # Stats Cards
                          - component: "container"
                            props:
                              style:
                                display: "grid"
                                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))"
                                gap: "20px"
                                marginBottom: "30px"
                              children:
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      padding: "25px"
                                      borderRadius: "12px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                      textAlign: "center"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "{{ projects.length }}"
                                          style:
                                            fontSize: "36px"
                                            fontWeight: "bold"
                                            color: "#8e44ad"
                                            marginBottom: "10px"
                                            
                                      - component: "display"
                                        props:
                                          text: "Active Projects"
                                          style:
                                            color: "#7f8c8d"
                                            fontSize: "16px"
                                            
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      padding: "25px"
                                      borderRadius: "12px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                      textAlign: "center"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "{{ tasks.length }}"
                                          style:
                                            fontSize: "36px"
                                            fontWeight: "bold"
                                            color: "#3498db"
                                            marginBottom: "10px"
                                            
                                      - component: "display"
                                        props:
                                          text: "Total Tasks"
                                          style:
                                            color: "#7f8c8d"
                                            fontSize: "16px"
                                            
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      padding: "25px"
                                      borderRadius: "12px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                      textAlign: "center"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "{{ tasks.filter(t => t.status === 'completed').length }}"
                                          style:
                                            fontSize: "36px"
                                            fontWeight: "bold"
                                            color: "#27ae60"
                                            marginBottom: "10px"
                                            
                                      - component: "display"
                                        props:
                                          text: "Completed Tasks"
                                          style:
                                            color: "#7f8c8d"
                                            fontSize: "16px"
                                            
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      padding: "25px"
                                      borderRadius: "12px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                      textAlign: "center"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "{{ teamMembers.length }}"
                                          style:
                                            fontSize: "36px"
                                            fontWeight: "bold"
                                            color: "#e67e22"
                                            marginBottom: "10px"
                                            
                                      - component: "display"
                                        props:
                                          text: "Team Members"
                                          style:
                                            color: "#7f8c8d"
                                            fontSize: "16px"
                                            
                          # Recent Projects
                          - component: "container"
                            props:
                              style:
                                backgroundColor: "white"
                                padding: "25px"
                                borderRadius: "12px"
                                boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                              children:
                                - component: "display"
                                  props:
                                    text: "📋 Recent Projects"
                                    style:
                                      fontSize: "20px"
                                      fontWeight: "bold"
                                      marginBottom: "20px"
                                      color: "#2c3e50"
                                      
                                - component: "conditional"
                                  props:
                                    condition: "{{ projects.length > 0 }}"
                                    component:
                                      component: "list"
                                      props:
                                        items: "{{ projects.slice(0, 5) }}"
                                        itemTemplate:
                                          component: "container"
                                          props:
                                            style:
                                              display: "flex"
                                              justifyContent: "space-between"
                                              alignItems: "center"
                                              padding: "15px"
                                              border: "1px solid #ecf0f1"
                                              borderRadius: "8px"
                                              marginBottom: "10px"
                                              cursor: "pointer"
                                            onClick: "selectProject"
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
                                                        text: "{{ item.description }}"
                                                        style:
                                                          color: "#7f8c8d"
                                                          fontSize: "14px"
                                                          
                                              - component: "container"
                                                props:
                                                  style:
                                                    textAlign: "right"
                                                  children:
                                                    - component: "display"
                                                      props:
                                                        text: "{{ item.status }}"
                                                        style:
                                                          padding: "4px 12px"
                                                          borderRadius: "20px"
                                                          fontSize: "12px"
                                                          backgroundColor: "{{ item.status === 'active' ? '#27ae60' : item.status === 'planning' ? '#f39c12' : '#95a5a6' }}"
                                                          color: "white"
                                                          marginBottom: "5px"
                                                          
                                                    - component: "display"
                                                      props:
                                                        text: "Due: {{ item.dueDate }}"
                                                        style:
                                                          fontSize: "12px"
                                                          color: "#7f8c8d"
                                                          
                                - component: "conditional"
                                  props:
                                    condition: "{{ projects.length === 0 }}"
                                    component:
                                      component: "display"
                                      props:
                                        text: "No projects yet. Create your first project!"
                                        style:
                                          textAlign: "center"
                                          color: "#95a5a6"
                                          padding: "40px"
                                          
                # Tasks View
                - component: "conditional"
                  props:
                    condition: "{{ currentView === 'tasks' }}"
                    component:
                      component: "container"
                      props:
                        children:
                          - component: "container"
                            props:
                              style:
                                display: "flex"
                                justifyContent: "space-between"
                                alignItems: "center"
                                marginBottom: "30px"
                              children:
                                - component: "display"
                                  props:
                                    text: "✅ Task Management"
                                    style:
                                      fontSize: "28px"
                                      fontWeight: "bold"
                                      color: "#2c3e50"
                                      
                                - component: "button"
                                  props:
                                    text: "➕ New Task"
                                    onClick: "showNewTask"
                                    style:
                                      backgroundColor: "#27ae60"
                                      color: "white"
                                      padding: "12px 20px"
                                      border: "none"
                                      borderRadius: "8px"
                                      cursor: "pointer"
                                      fontWeight: "bold"
                                      
                          # Task Filters
                          - component: "container"
                            props:
                              style:
                                display: "flex"
                                gap: "15px"
                                marginBottom: "20px"
                              children:
                                - component: "select"
                                  props:
                                    value: "{{ filterStatus }}"
                                    onChange: "filterTasksByStatus"
                                    options:
                                      - { value: "all", label: "All Statuses" }
                                      - { value: "todo", label: "To Do" }
                                      - { value: "in-progress", label: "In Progress" }
                                      - { value: "completed", label: "Completed" }
                                    style:
                                      padding: "10px"
                                      border: "1px solid #bdc3c7"
                                      borderRadius: "6px"
                                      
                                - component: "select"
                                  props:
                                    value: "{{ filterAssignee }}"
                                    onChange: "filterTasksByAssignee"
                                    options: "{{ [{ value: 'all', label: 'All Assignees' }, ...teamMembers.map(member => ({ value: member.id, label: member.name }))] }}"
                                    style:
                                      padding: "10px"
                                      border: "1px solid #bdc3c7"
                                      borderRadius: "6px"
                                      
                          # Tasks Board
                          - component: "container"
                            props:
                              style:
                                display: "grid"
                                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))"
                                gap: "20px"
                              children:
                                # To Do Column
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      borderRadius: "12px"
                                      padding: "20px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "📝 To Do"
                                          style:
                                            fontSize: "18px"
                                            fontWeight: "bold"
                                            marginBottom: "15px"
                                            color: "#f39c12"
                                            
                                      - component: "list"
                                        props:
                                          items: "{{ tasks.filter(task => task.status === 'todo') }}"
                                          itemTemplate:
                                            component: "container"
                                            props:
                                              style:
                                                border: "1px solid #ecf0f1"
                                                borderRadius: "8px"
                                                padding: "15px"
                                                marginBottom: "10px"
                                                cursor: "pointer"
                                                backgroundColor: "#fefefe"
                                              onClick: "selectTask"
                                              children:
                                                - component: "display"
                                                  props:
                                                    text: "{{ item.title }}"
                                                    style:
                                                      fontWeight: "bold"
                                                      marginBottom: "8px"
                                                      
                                                - component: "display"
                                                  props:
                                                    text: "{{ item.description }}"
                                                    style:
                                                      fontSize: "14px"
                                                      color: "#7f8c8d"
                                                      marginBottom: "10px"
                                                      
                                                - component: "container"
                                                  props:
                                                    style:
                                                      display: "flex"
                                                      justifyContent: "space-between"
                                                      alignItems: "center"
                                                    children:
                                                      - component: "display"
                                                        props:
                                                          text: "{{ item.assignee || 'Unassigned' }}"
                                                          style:
                                                            fontSize: "12px"
                                                            color: "#95a5a6"
                                                            
                                                      - component: "display"
                                                        props:
                                                          text: "{{ item.priority }}"
                                                          style:
                                                            padding: "2px 8px"
                                                            borderRadius: "10px"
                                                            fontSize: "10px"
                                                            backgroundColor: "{{ item.priority === 'high' ? '#e74c3c' : item.priority === 'medium' ? '#f39c12' : '#95a5a6' }}"
                                                            color: "white"
                                                            
                                # In Progress Column  
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      borderRadius: "12px"
                                      padding: "20px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "⏳ In Progress"
                                          style:
                                            fontSize: "18px"
                                            fontWeight: "bold"
                                            marginBottom: "15px"
                                            color: "#3498db"
                                            
                                      - component: "list"
                                        props:
                                          items: "{{ tasks.filter(task => task.status === 'in-progress') }}"
                                          itemTemplate:
                                            component: "container"
                                            props:
                                              style:
                                                border: "1px solid #3498db"
                                                borderRadius: "8px"
                                                padding: "15px"
                                                marginBottom: "10px"
                                                cursor: "pointer"
                                                backgroundColor: "#e3f2fd"
                                              onClick: "selectTask"
                                              children:
                                                - component: "display"
                                                  props:
                                                    text: "{{ item.title }}"
                                                    style:
                                                      fontWeight: "bold"
                                                      marginBottom: "8px"
                                                      
                                                - component: "display"
                                                  props:
                                                    text: "{{ item.description }}"
                                                    style:
                                                      fontSize: "14px"
                                                      color: "#7f8c8d"
                                                      marginBottom: "10px"
                                                      
                                                - component: "container"
                                                  props:
                                                    style:
                                                      display: "flex"
                                                      justifyContent: "space-between"
                                                      alignItems: "center"
                                                    children:
                                                      - component: "display"
                                                        props:
                                                          text: "{{ item.assignee || 'Unassigned' }}"
                                                          style:
                                                            fontSize: "12px"
                                                            color: "#95a5a6"
                                                            
                                                      - component: "display"
                                                        props:
                                                          text: "{{ item.priority }}"
                                                          style:
                                                            padding: "2px 8px"
                                                            borderRadius: "10px"
                                                            fontSize: "10px"
                                                            backgroundColor: "{{ item.priority === 'high' ? '#e74c3c' : item.priority === 'medium' ? '#f39c12' : '#95a5a6' }}"
                                                            color: "white"
                                                            
                                # Completed Column
                                - component: "container"
                                  props:
                                    style:
                                      backgroundColor: "white"
                                      borderRadius: "12px"
                                      padding: "20px"
                                      boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
                                    children:
                                      - component: "display"
                                        props:
                                          text: "✅ Completed"
                                          style:
                                            fontSize: "18px"
                                            fontWeight: "bold"
                                            marginBottom: "15px"
                                            color: "#27ae60"
                                            
                                      - component: "list"
                                        props:
                                          items: "{{ tasks.filter(task => task.status === 'completed') }}"
                                          itemTemplate:
                                            component: "container"
                                            props:
                                              style:
                                                border: "1px solid #27ae60"
                                                borderRadius: "8px"
                                                padding: "15px"
                                                marginBottom: "10px"
                                                cursor: "pointer"
                                                backgroundColor: "#e8f5e8"
                                              onClick: "selectTask"
                                              children:
                                                - component: "display"
                                                  props:
                                                    text: "{{ item.title }}"
                                                    style:
                                                      fontWeight: "bold"
                                                      marginBottom: "8px"
                                                      textDecoration: "line-through"
                                                      
                                                - component: "display"
                                                  props:
                                                    text: "{{ item.description }}"
                                                    style:
                                                      fontSize: "14px"
                                                      color: "#7f8c8d"
                                                      marginBottom: "10px"
                                                      
                                                - component: "container"
                                                  props:
                                                    style:
                                                      display: "flex"
                                                      justifyContent: "space-between"
                                                      alignItems: "center"
                                                    children:
                                                      - component: "display"
                                                        props:
                                                          text: "{{ item.assignee || 'Unassigned' }}"
                                                          style:
                                                            fontSize: "12px"
                                                            color: "#95a5a6"
                                                            
                                                      - component: "display"
                                                        props:
                                                          text: "Done ✓"
                                                          style:
                                                            padding: "2px 8px"
                                                            borderRadius: "10px"
                                                            fontSize: "10px"
                                                            backgroundColor: "#27ae60"
                                                            color: "white"

  actions:
    switchView:
      type: "setState"
      path: "currentView"
      value: "{{ data.view }}"
      
    loadSampleData:
      type: "setState"
      path: "projects"
      value: "{{ [
        { id: 1, name: 'Website Redesign', description: 'Complete redesign of company website', status: 'active', dueDate: '2025-01-15', progress: 65 },
        { id: 2, name: 'Mobile App Development', description: 'Develop iOS and Android mobile applications', status: 'planning', dueDate: '2025-03-01', progress: 20 },
        { id: 3, name: 'Database Migration', description: 'Migrate legacy database to cloud infrastructure', status: 'active', dueDate: '2025-02-10', progress: 80 }
      ] }}"
      then:
        - type: "setState"
          path: "tasks"
          value: "{{ [
            { id: 1, title: 'Design Homepage Mockup', description: 'Create wireframes and mockups for new homepage', status: 'completed', priority: 'high', assignee: 'Alice Johnson', projectId: 1 },
            { id: 2, title: 'Implement User Authentication', description: 'Add login and registration functionality', status: 'in-progress', priority: 'high', assignee: 'Bob Smith', projectId: 1 },
            { id: 3, title: 'Write API Documentation', description: 'Document all REST API endpoints', status: 'todo', priority: 'medium', assignee: 'Carol Davis', projectId: 2 },
            { id: 4, title: 'Set up CI/CD Pipeline', description: 'Configure automated deployment pipeline', status: 'todo', priority: 'low', assignee: null, projectId: 2 },
            { id: 5, title: 'Database Schema Design', description: 'Design new database schema structure', status: 'completed', priority: 'high', assignee: 'David Wilson', projectId: 3 }
          ] }}"
        - type: "setState"
          path: "teamMembers"
          value: "{{ [
            { id: 1, name: 'Alice Johnson', role: 'UI/UX Designer', email: 'alice@company.com', tasksCount: 3 },
            { id: 2, name: 'Bob Smith', role: 'Frontend Developer', email: 'bob@company.com', tasksCount: 5 },
            { id: 3, name: 'Carol Davis', role: 'Backend Developer', email: 'carol@company.com', tasksCount: 2 },
            { id: 4, name: 'David Wilson', role: 'DevOps Engineer', email: 'david@company.com', tasksCount: 4 }
          ] }}"
      
    selectProject:
      type: "setState"
      path: "selectedProject"
      value: "{{ item }}"
      
    selectTask:
      type: "setState"
      path: "currentTask"
      value: "{{ item }}"
      then:
        - type: "setState"
          path: "showTaskModal"
          value: true
          
    showNewTask:
      type: "setState"
      path: "showTaskModal"
      value: true
      then:
        - type: "setState"
          path: "currentTask"
          value: null
          
    showNewProject:
      type: "setState"
      path: "showProjectModal"
      value: true
      
    filterTasksByStatus:
      type: "setState"
      path: "filterStatus"
      value: "{{ value }}"
      
    filterTasksByAssignee:
      type: "setState"
      path: "filterAssignee"
      value: "{{ value }}"
```