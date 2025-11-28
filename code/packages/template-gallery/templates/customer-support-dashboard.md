# Customer Support Dashboard Template

```yaml
GLASSVIEW_APP:
  name: "Customer Support Dashboard"
  description: "Complete dashboard for customer support teams to manage tickets and help customers"
  category: "Business"
  difficulty: "Intermediate"
  features:
    - "Ticket search and filtering"
    - "Real-time ticket status updates" 
    - "Customer information display"
    - "Priority and category management"
    - "Support agent assignment"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Support Dashboard"
      theme:
        primaryColor: "#3498db"
        secondaryColor: "#2c3e50"
        backgroundColor: "#f8f9fa"
      initialState:
        searchQuery: ""
        selectedPriority: "all"
        selectedStatus: "all"
        tickets: []
        currentTicket: null
        supportAgents: [
          { id: 1, name: "Alice Johnson", status: "available", tickets: 3 },
          { id: 2, name: "Bob Smith", status: "busy", tickets: 7 },
          { id: 3, name: "Carol Davis", status: "available", tickets: 2 }
        ]
        
  layout:
    - component: "display"
      props:
        text: "🎧 Customer Support Dashboard"
        style:
          fontSize: "28px"
          fontWeight: "bold"
          color: "#2c3e50"
          marginBottom: "20px"
          textAlign: "center"
          
    - component: "container"
      props:
        style:
          display: "flex"
          gap: "20px"
          marginBottom: "20px"
        children:
          - component: "input"
            props:
              placeholder: "Search tickets by customer or issue..."
              value: "{{ searchQuery }}"
              onChange: "updateSearch"
              style:
                flex: "1"
                padding: "10px"
                border: "1px solid #bdc3c7"
                borderRadius: "4px"
                
          - component: "select"
            props:
              value: "{{ selectedPriority }}"
              onChange: "filterByPriority"
              options:
                - { value: "all", label: "All Priorities" }
                - { value: "high", label: "High Priority" }
                - { value: "medium", label: "Medium Priority" } 
                - { value: "low", label: "Low Priority" }
              style:
                padding: "10px"
                border: "1px solid #bdc3c7"
                borderRadius: "4px"
                
          - component: "select"
            props:
              value: "{{ selectedStatus }}"
              onChange: "filterByStatus"
              options:
                - { value: "all", label: "All Statuses" }
                - { value: "open", label: "Open" }
                - { value: "in-progress", label: "In Progress" }
                - { value: "resolved", label: "Resolved" }
                - { value: "closed", label: "Closed" }
              style:
                padding: "10px"
                border: "1px solid #bdc3c7"
                borderRadius: "4px"
                
          - component: "button"
            props:
              text: "🔍 Search"
              onClick: "searchTickets"
              style:
                backgroundColor: "#3498db"
                color: "white"
                padding: "10px 20px"
                border: "none"
                borderRadius: "4px"
                cursor: "pointer"
                
    - component: "container"
      props:
        style:
          display: "grid"
          gridTemplateColumns: "2fr 1fr"
          gap: "20px"
        children:
          # Tickets List
          - component: "container"
            props:
              style:
                backgroundColor: "white"
                border: "1px solid #ecf0f1"
                borderRadius: "8px"
                padding: "20px"
              children:
                - component: "display"
                  props:
                    text: "🎫 Support Tickets"
                    style:
                      fontSize: "20px"
                      fontWeight: "bold"
                      marginBottom: "15px"
                      color: "#2c3e50"
                      
                - component: "conditional"
                  props:
                    condition: "{{ tickets.length > 0 }}"
                    component:
                      component: "list"
                      props:
                        items: "{{ tickets }}"
                        itemTemplate:
                          component: "container"
                          props:
                            style:
                              border: "1px solid #ecf0f1"
                              borderRadius: "4px"
                              padding: "15px"
                              marginBottom: "10px"
                              cursor: "pointer"
                              backgroundColor: "{{ item.id === currentTicket?.id ? '#e3f2fd' : '#ffffff' }}"
                            onClick: "selectTicket"
                            children:
                              - component: "container"
                                props:
                                  style:
                                    display: "flex"
                                    justifyContent: "space-between"
                                    alignItems: "center"
                                    marginBottom: "8px"
                                  children:
                                    - component: "display"
                                      props:
                                        text: "#{{ item.id }} - {{ item.subject }}"
                                        style:
                                          fontWeight: "bold"
                                          fontSize: "16px"
                                          
                                    - component: "display"
                                      props:
                                        text: "{{ item.priority }}"
                                        style:
                                          padding: "4px 8px"
                                          borderRadius: "12px"
                                          fontSize: "12px"
                                          backgroundColor: "{{ item.priority === 'high' ? '#e74c3c' : item.priority === 'medium' ? '#f39c12' : '#27ae60' }}"
                                          color: "white"
                                          
                              - component: "display"
                                props:
                                  text: "Customer: {{ item.customer }} | Status: {{ item.status }}"
                                  style:
                                    color: "#7f8c8d"
                                    fontSize: "14px"
                                    marginBottom: "5px"
                                    
                              - component: "display"
                                props:
                                  text: "Assigned to: {{ item.assignedTo || 'Unassigned' }}"
                                  style:
                                    color: "#7f8c8d"
                                    fontSize: "14px"
                                    
                - component: "conditional"
                  props:
                    condition: "{{ tickets.length === 0 }}"
                    component:
                      component: "display"
                      props:
                        text: "No tickets found. Try adjusting your search or filters."
                        style:
                          textAlign: "center"
                          color: "#95a5a6"
                          fontStyle: "italic"
                          padding: "40px"
                          
          # Side Panel
          - component: "container"
            props:
              style:
                display: "flex"
                flexDirection: "column"
                gap: "20px"
              children:
                # Support Agents
                - component: "container"
                  props:
                    style:
                      backgroundColor: "white"
                      border: "1px solid #ecf0f1"
                      borderRadius: "8px"
                      padding: "20px"
                    children:
                      - component: "display"
                        props:
                          text: "👥 Support Agents"
                          style:
                            fontSize: "18px"
                            fontWeight: "bold"
                            marginBottom: "15px"
                            color: "#2c3e50"
                            
                      - component: "list"
                        props:
                          items: "{{ supportAgents }}"
                          itemTemplate:
                            component: "container"
                            props:
                              style:
                                display: "flex"
                                justifyContent: "space-between"
                                alignItems: "center"
                                padding: "10px"
                                borderBottom: "1px solid #ecf0f1"
                              children:
                                - component: "container"
                                  props:
                                    children:
                                      - component: "display"
                                        props:
                                          text: "{{ item.name }}"
                                          style:
                                            fontWeight: "bold"
                                            fontSize: "14px"
                                            
                                      - component: "display"
                                        props:
                                          text: "{{ item.tickets }} tickets"
                                          style:
                                            fontSize: "12px"
                                            color: "#7f8c8d"
                                            
                                - component: "display"
                                  props:
                                    text: "{{ item.status }}"
                                    style:
                                      padding: "4px 8px"
                                      borderRadius: "8px"
                                      fontSize: "11px"
                                      backgroundColor: "{{ item.status === 'available' ? '#27ae60' : '#e74c3c' }}"
                                      color: "white"
                                      
                # Ticket Details
                - component: "conditional"
                  props:
                    condition: "{{ currentTicket !== null }}"
                    component:
                      component: "container"
                      props:
                        style:
                          backgroundColor: "white"
                          border: "1px solid #ecf0f1"
                          borderRadius: "8px"
                          padding: "20px"
                        children:
                          - component: "display"
                            props:
                              text: "🎫 Ticket Details"
                              style:
                                fontSize: "18px"
                                fontWeight: "bold"
                                marginBottom: "15px"
                                color: "#2c3e50"
                                
                          - component: "display"
                            props:
                              text: "#{{ currentTicket.id }} - {{ currentTicket.subject }}"
                              style:
                                fontSize: "16px"
                                fontWeight: "bold"
                                marginBottom: "10px"
                                
                          - component: "display"
                            props:
                              text: "Customer: {{ currentTicket.customer }}"
                              style:
                                marginBottom: "5px"
                                
                          - component: "display"
                            props:
                              text: "Status: {{ currentTicket.status }}"
                              style:
                                marginBottom: "5px"
                                
                          - component: "display"
                            props:
                              text: "Priority: {{ currentTicket.priority }}"
                              style:
                                marginBottom: "10px"
                                
                          - component: "display"
                            props:
                              text: "{{ currentTicket.description }}"
                              style:
                                padding: "10px"
                                backgroundColor: "#f8f9fa"
                                borderRadius: "4px"
                                marginBottom: "15px"
                                
                          - component: "container"
                            props:
                              style:
                                display: "flex"
                                gap: "10px"
                              children:
                                - component: "button"
                                  props:
                                    text: "Take Ticket"
                                    onClick: "takeTicket"
                                    style:
                                      backgroundColor: "#27ae60"
                                      color: "white"
                                      padding: "8px 16px"
                                      border: "none"
                                      borderRadius: "4px"
                                      cursor: "pointer"
                                      
                                - component: "button"
                                  props:
                                    text: "Close Ticket"
                                    onClick: "closeTicket"
                                    style:
                                      backgroundColor: "#e74c3c"
                                      color: "white"
                                      padding: "8px 16px"
                                      border: "none"
                                      borderRadius: "4px"
                                      cursor: "pointer"

  actions:
    updateSearch:
      type: "setState"
      path: "searchQuery"
      value: "{{ value }}"
      
    filterByPriority:
      type: "setState"
      path: "selectedPriority"
      value: "{{ value }}"
      
    filterByStatus:
      type: "setState"
      path: "selectedStatus"
      value: "{{ value }}"
      
    searchTickets:
      type: "setState"
      path: "tickets"
      value: "{{ [
        { id: 1001, subject: 'Login Issues', customer: 'John Doe', status: 'open', priority: 'high', assignedTo: 'Alice Johnson', description: 'User cannot log into their account. Password reset attempts have failed.' },
        { id: 1002, subject: 'Billing Question', customer: 'Jane Smith', status: 'in-progress', priority: 'medium', assignedTo: 'Bob Smith', description: 'Customer questions about recent charges on their account.' },
        { id: 1003, subject: 'Feature Request', customer: 'Mike Johnson', status: 'open', priority: 'low', assignedTo: null, description: 'Request for dark mode theme in the application.' },
        { id: 1004, subject: 'Bug Report', customer: 'Sarah Wilson', status: 'resolved', priority: 'high', assignedTo: 'Carol Davis', description: 'Application crashes when uploading large files.' },
        { id: 1005, subject: 'Account Setup Help', customer: 'Tom Brown', status: 'open', priority: 'medium', assignedTo: null, description: 'New customer needs help setting up their account and configuring preferences.' }
      ] }}"
      
    selectTicket:
      type: "setState"
      path: "currentTicket"
      value: "{{ item }}"
      
    takeTicket:
      type: "setState"
      path: "currentTicket.assignedTo"
      value: "Current Agent"
      then:
        - type: "setState"
          path: "currentTicket.status"
          value: "in-progress"
          
    closeTicket:
      type: "setState"
      path: "currentTicket.status"
      value: "resolved"
```