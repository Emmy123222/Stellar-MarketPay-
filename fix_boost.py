with open('frontend/components/BoostJobModal.tsx', 'r') as f:
    c = f.read()
old = '    badge: "⚡ Featured",
  },'
new = '    badge: "⚡ Featured",
    recommended: false,
  },'
with open('frontend/components/BoostJobModal.tsx', 'w') as f:
    f.write(c.replace(old, new))
