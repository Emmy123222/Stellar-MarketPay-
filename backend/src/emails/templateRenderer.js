function renderTemplate(templateName, variables) {
  const templates = {
    new_application: `
      <html>
        <body>
          <h2>New Application Received</h2>
          <p>Hello {{clientName}},</p>
          <p>You have received a new application for your job "<strong>{{jobTitle}}</strong>".</p>
          <p>Freelancer: {{freelancerName}}</p>
          <a href="{{jobUrl}}">View Application</a>
        </body>
      </html>
    `,
    application_accepted: `
      <html>
        <body>
          <h2>Application Accepted</h2>
          <p>Hello {{freelancerName}},</p>
          <p>Congratulations! Your application for the job "<strong>{{jobTitle}}</strong>" has been accepted.</p>
          <a href="{{jobUrl}}">View Job</a>
        </body>
      </html>
    `,
    escrow_released: `
      <html>
        <body>
          <h2>Escrow Released</h2>
          <p>Hello {{userName}},</p>
          <p>The escrow for the job "<strong>{{jobTitle}}</strong>" has been successfully released.</p>
          <p>Amount: {{amount}} {{currency}}</p>
          <a href="{{jobUrl}}">View Job</a>
        </body>
      </html>
    `
  };

  const template = templates[templateName];
  if (!template) {
    throw new Error(`Template ${templateName} not found`);
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

module.exports = { renderTemplate };
