import json
import psycopg2
import os

def lambda_handler(event, context):
    user = event['request']['userAttributes']  # fixed typo: userAtributes → userAttributes
    print('userAttributes:', user)

    user_display_name = user.get('name')
    user_email        = user.get('email')
    user_handle       = user.get('preferred_username')  # You were overwriting email here before!
    user_cognito_id   = user.get('sub')

    try:
        conn = psycopg2.connect(os.getenv('CONNECTION_URL'))
        cur = conn.cursor()

        # Use parameterized queries to avoid SQL injection
        sql = """
            INSERT INTO users (
                display_name, 
                email,
                handle, 
                cognito_user_id
            ) 
            VALUES (%s, %s, %s, %s)
        """
        cur.execute(sql, (user_display_name, user_email, user_handle, user_cognito_id))
        conn.commit()

    except (Exception, psycopg2.DatabaseError) as error:
        print("Database error:", error)

    finally:
        if conn:
            cur.close()
            conn.close()
            print('Database connection closed.')

    return event
