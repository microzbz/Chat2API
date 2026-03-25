# Chat2API Manager v1.1.4 Release Notes

## 🎉 Major Features

### Clear Chat History
- **Qwen AI**: Add "Clear Chat History" feature to delete all conversation history from Qwen AI website
- **MiniMax**: Add batch delete functionality to remove all conversations
- Confirmation dialog with warning message to prevent accidental deletion

### Enhanced Thinking Mode Control (Qwen AI)
- Support model name suffixes for fine-grained control:
  - `-thinking`: Force enable thinking mode
  - `-fast`: Force disable thinking mode (fast responses)
- Default to disable thinking mode and auto-search for faster responses
- Explicit `enable_thinking` parameter support

### Improved Credit Display (MiniMax)
- Updated to use new membership API endpoint
- Added credit expiration timestamp display
- Shows remaining daily login gift credits

## 🚀 Improvements

### Request Logging Enhancement
- Added response body logging